import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

let ffmpegInstance = null
let isLoaded = false

/**
 * Initialize FFmpeg instance (loads WASM files)
 */
const initFFmpeg = async () => {
  if (isLoaded && ffmpegInstance) {
    return ffmpegInstance
  }

  const ffmpeg = new FFmpeg()
  
  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm'
  
  try {
    // Load FFmpeg core
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    })
    
    ffmpegInstance = ffmpeg
    isLoaded = true
    
    return ffmpeg
  } catch (error) {
    console.error('Error loading FFmpeg:', error)
    throw error
  }
}

/**
 * Compress video file using FFmpeg
 * @param {File} videoFile - The video file to compress
 * @param {Object} options - Compression options
 * @returns {Promise<File>} - Compressed video file
 */
export const compressVideo = async (videoFile, options = {}) => {
  const {
    maxSizeMB = 95, // Target max size (leave room under 100MB Cloudinary limit)
    quality = 'medium', // 'low', 'medium', 'high'
    progressCallback = null,
    timeout = 110000 // 110 seconds timeout (slightly less than UI timeout)
  } = options

  try {
    console.log('🎬 Starting video compression...', {
      fileName: videoFile.name,
      fileSize: `${(videoFile.size / (1024 * 1024)).toFixed(2)}MB`,
      timeout: `${timeout / 1000}s`
    })
    
    // Create a timeout promise that will reject if compression takes too long
    let timeoutId = null
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Compression timeout: Video processing exceeded ${timeout / 1000} seconds. Please try a shorter video or post the original file.`))
      }, timeout)
    })
    
    // Initialize FFmpeg with timeout
    const initPromise = initFFmpeg()
    const ffmpeg = await Promise.race([initPromise, timeoutPromise])
    
    // Clear timeout once FFmpeg is initialized
    if (timeoutId) clearTimeout(timeoutId)
    
    // Set up progress callback
    if (progressCallback) {
      ffmpeg.on('progress', ({ progress }) => {
        progressCallback(progress * 100)
      })
    }

    // Write input file to FFmpeg virtual file system (with timeout)
    const inputFileName = 'input.mp4'
    const writeFilePromise = ffmpeg.writeFile(inputFileName, await fetchFile(videoFile))
    const writeTimeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Timeout: Failed to load video file into FFmpeg')), 30000)
    })
    await Promise.race([writeFilePromise, writeTimeoutPromise])

    // Determine compression settings based on quality
    let videoBitrate = '2000k' // 2 Mbps default
    let resolution = '1280:720' // 720p default
    let fps = 30

    switch (quality) {
      case 'low':
        videoBitrate = '1000k' // 1 Mbps
        resolution = '854:480' // 480p
        fps = 24
        break
      case 'high':
        videoBitrate = '3000k' // 3 Mbps
        resolution = '1280:720' // 720p
        fps = 30
        break
      default: // medium
        videoBitrate = '2000k' // 2 Mbps
        resolution = '1280:720' // 720p
        fps = 30
    }

    // Compress video with timeout protection
    const outputFileName = 'output.mp4'
    
    // Create exec timeout promise
    const execTimeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('FFmpeg execution timeout: Compression process took too long')), timeout - 30000)
    })
    
    // FFmpeg command: compress video with H.264 codec
    const execPromise = ffmpeg.exec([
      '-i', inputFileName,
      '-c:v', 'libx264',           // Video codec
      '-preset', 'fast',            // Faster encoding (was 'medium')
      '-crf', '28',                 // Constant Rate Factor (lower = better quality, higher file size)
      '-vf', `scale=${resolution}`, // Scale to target resolution
      '-r', fps.toString(),         // Frame rate
      '-b:v', videoBitrate,         // Video bitrate
      '-maxrate', videoBitrate,     // Max bitrate
      '-bufsize', (parseInt(videoBitrate) * 2) + 'k', // Buffer size
      '-c:a', 'aac',                // Audio codec
      '-b:a', '128k',               // Audio bitrate
      '-movflags', '+faststart',    // Web optimization
      '-threads', '2',              // Use 2 threads for faster processing
      '-y',                         // Overwrite output file
      outputFileName
    ])
    
    await Promise.race([execPromise, execTimeoutPromise])

    // Read output file
    const data = await ffmpeg.readFile(outputFileName)
    const compressedBlob = new Blob([data], { type: 'video/mp4' })

    // Check if compressed size is acceptable
    const compressedSizeMB = compressedBlob.size / (1024 * 1024)
    console.log(`Compressed video size: ${compressedSizeMB.toFixed(2)}MB`)

    // If still too large, try more aggressive compression (with timeout)
    if (compressedSizeMB > maxSizeMB) {
      console.log('⚠️ Video still too large, applying more aggressive compression...')
      
      // Delete previous output
      await ffmpeg.deleteFile(outputFileName)
      
      // More aggressive settings with timeout
      const aggressiveExecPromise = ffmpeg.exec([
        '-i', inputFileName,
        '-c:v', 'libx264',
        '-preset', 'fast',          // Use 'fast' instead of 'slow' for better timeout handling
        '-crf', '32',               // Higher CRF = more compression
        '-vf', `scale=854:480`,     // Lower resolution (480p)
        '-r', '24',                 // Lower frame rate
        '-b:v', '800k',             // Lower bitrate
        '-maxrate', '800k',
        '-bufsize', '1600k',
        '-c:a', 'aac',
        '-b:a', '96k',              // Lower audio bitrate
        '-movflags', '+faststart',
        '-threads', '2',            // Use 2 threads
        '-y',
        outputFileName
      ])
      
      const aggressiveTimeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Aggressive compression timeout')), 60000) // 1 minute for aggressive compression
      })
      
      await Promise.race([aggressiveExecPromise, aggressiveTimeoutPromise])

      const aggressiveData = await ffmpeg.readFile(outputFileName)
      const aggressiveBlob = new Blob([aggressiveData], { type: 'video/mp4' })
      
      const aggressiveSizeMB = aggressiveBlob.size / (1024 * 1024)
      console.log(`✅ After aggressive compression: ${aggressiveSizeMB.toFixed(2)}MB`)
      
      // Create File object from blob
      const compressedFile = new File(
        [aggressiveBlob],
        videoFile.name.replace(/\.[^/.]+$/, '.mp4'),
        { type: 'video/mp4' }
      )
      
      // Clean up
      await ffmpeg.deleteFile(inputFileName)
      await ffmpeg.deleteFile(outputFileName)
      
      return compressedFile
    }

    // Create File object from blob
    const compressedFile = new File(
      [compressedBlob],
      videoFile.name.replace(/\.[^/.]+$/, '.mp4'),
      { type: 'video/mp4' }
    )

    // Clean up
    await ffmpeg.deleteFile(inputFileName)
    await ffmpeg.deleteFile(outputFileName)

    return compressedFile
  } catch (error) {
    console.error('Error compressing video:', error)
    throw error
  }
}

/**
 * Check if file needs compression
 * @param {File} file - File to check
 * @returns {boolean} - True if compression is recommended
 */
export const needsCompression = (file) => {
  if (!file) return false
  
  // Compress videos over 50MB (close to Cloudinary's 100MB limit)
  // Videos under 50MB can be uploaded directly without compression
  if (file.type.startsWith('video/')) {
    const sizeMB = file.size / (1024 * 1024)
    // Only compress if video is over 50MB (leaves room for Cloudinary's 100MB limit)
    return sizeMB > 50
  }
  
  return false
}

