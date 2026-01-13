// Firebase Cloud Messaging Service for Call Notifications
// Sends FCM push notifications for incoming calls (WhatsApp-like)

console.log('🔥 [FCM] Module loaded - fcmNotifications.js');

import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Firebase Admin SDK will be initialized here
let isInitialized = false;
let initializationAttempted = false;

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize Firebase Admin (will be called from index.js)
export function initializeFCM() {
  initializationAttempted = true;
  console.log('🔥 [FCM] ========== INITIALIZATION START ==========');
  console.log('🔥 [FCM] initializeFCM() called');
  
  try {
    console.log('🔥 [FCM] Step 1: Starting initialization...');
    
    let serviceAccount;
    
    // Try environment variable first (for cloud deployments like Render)
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      console.log('🔥 [FCM] Step 2: Using FIREBASE_SERVICE_ACCOUNT environment variable...');
      console.log('🔥 [FCM] Step 2: Env var length:', process.env.FIREBASE_SERVICE_ACCOUNT.length);
      console.log('🔥 [FCM] Step 2: Env var first 100 chars:', process.env.FIREBASE_SERVICE_ACCOUNT.substring(0, 100));
      try {
        // Try to parse the JSON string
        let envVarValue = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
        
        // Fix: Handle case where Render converts \n to actual newlines in the private_key
        // First, try to parse as-is
        try {
          serviceAccount = JSON.parse(envVarValue);
        } catch (firstParseError) {
          // If parsing fails, the private_key might have actual newlines instead of \n
          console.log('🔥 [FCM] Step 2: First parse failed, attempting to fix private key format...');
          console.log('🔥 [FCM] Step 2: Parse error:', firstParseError.message);
          
          // Try to fix: Find the private_key field and replace actual newlines with \n
          // This regex handles multi-line private keys
          const privateKeyMatch = envVarValue.match(/"private_key"\s*:\s*"([\s\S]*?)"\s*,/);
          if (privateKeyMatch) {
            const originalKey = privateKeyMatch[1];
            // Replace actual newlines and carriage returns with \n
            const fixedKey = originalKey
              .replace(/\r\n/g, '\\n')  // Windows newlines
              .replace(/\n/g, '\\n')     // Unix newlines
              .replace(/\r/g, '\\n');     // Old Mac newlines
            
            // Replace the original private_key with the fixed one
            envVarValue = envVarValue.replace(
              /"private_key"\s*:\s*"[\s\S]*?"\s*,/,
              `"private_key":"${fixedKey}",`
            );
            
            try {
              serviceAccount = JSON.parse(envVarValue);
              console.log('✅ [FCM] Step 2: Fixed private key newlines and parsed successfully');
            } catch (secondParseError) {
              console.error('❌ [FCM] Step 2: Still failed after fixing newlines:', secondParseError.message);
              throw firstParseError; // Throw original error
            }
          } else {
            throw firstParseError;
          }
        }
        
        // Fix private_key: Firebase Admin SDK needs actual newlines, not \n strings
        if (serviceAccount.private_key) {
          // If private_key has literal \n (backslash-n), convert to actual newlines
          if (serviceAccount.private_key.includes('\\n')) {
            console.log('🔥 [FCM] Step 2: Converting \\n to actual newlines in private_key');
            serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
          }
          // Ensure no carriage returns
          serviceAccount.private_key = serviceAccount.private_key.replace(/\r/g, '');
        }
        
        console.log('✅ [FCM] Step 2: Environment variable parsed successfully');
        console.log('✅ [FCM] Step 2: project_id:', serviceAccount.project_id);
        console.log('✅ [FCM] Step 2: private_key length:', serviceAccount.private_key?.length || 0);
        console.log('✅ [FCM] Step 2: private_key starts with:', serviceAccount.private_key?.substring(0, 50) || 'N/A');
      } catch (parseError) {
        console.error('❌ [FCM] Step 2: Failed to parse environment variable');
        console.error('❌ [FCM] Step 2: Parse error:', parseError.message);
        console.error('❌ [FCM] Step 2: Env var value (first 200 chars):', process.env.FIREBASE_SERVICE_ACCOUNT.substring(0, 200));
        throw new Error('Failed to parse FIREBASE_SERVICE_ACCOUNT environment variable: ' + parseError.message);
      }
    } else {
      // Fallback to file (for local development)
      console.log('🔥 [FCM] Step 2: Using firebase-service-account.json file...');
      const serviceAccountPath = join(__dirname, '../firebase-service-account.json');
      console.log('🔥 [FCM] Step 2: Service account path:', serviceAccountPath);
      
      try {
        const fileContent = readFileSync(serviceAccountPath, 'utf8');
        console.log('🔥 [FCM] Step 3: File read successfully, length:', fileContent.length);
        
        if (!fileContent || fileContent.trim().length === 0) {
          throw new Error('Service account file is empty');
        }
        
        serviceAccount = JSON.parse(fileContent);
        console.log('✅ [FCM] Step 3: JSON parsed, project_id:', serviceAccount.project_id);
      } catch (fileError) {
        throw new Error('Failed to read service account file: ' + fileError.message);
      }
    }
    
    console.log('🔥 [FCM] Step 4: Checking admin apps...');
    console.log('🔥 [FCM] Step 4: admin.apps.length:', admin.apps.length);
    
    if (!admin.apps.length) {
      console.log('🔥 [FCM] Step 5: Initializing Firebase Admin...');
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      isInitialized = true;
      console.log('✅ [FCM] Step 5: Firebase Admin initialized successfully');
      console.log('✅ [FCM] Admin apps count:', admin.apps.length);
    } else {
      isInitialized = true;
      console.log('✅ [FCM] Firebase Admin already initialized');
    }
    
    console.log('✅ [FCM] ========== INITIALIZATION SUCCESS ==========');
  } catch (error) {
    console.error('❌ [FCM] ========== INITIALIZATION FAILED ==========');
    console.error('❌ [FCM] Error type:', error.constructor.name);
    console.error('❌ [FCM] Error message:', error.message);
    console.error('❌ [FCM] Error code:', error.code);
    console.error('❌ [FCM] Error stack:', error.stack);
    console.error('⚠️ [FCM] Options:');
    console.error('   1. Set FIREBASE_SERVICE_ACCOUNT environment variable (for cloud)');
    console.error('   2. Or place firebase-service-account.json in backend folder (for local)');
    isInitialized = false;
    console.error('❌ [FCM] ========== END ERROR ==========');
    // Don't throw - let the app continue, but FCM won't work
  }
}

/**
 * Send FCM push notification for incoming call
 * @param {string} fcmToken - FCM token of the receiver
 * @param {string} callerName - Name of the caller
 * @param {string} callerId - ID of the caller
 * @param {string} callType - 'audio' or 'video'
 * @param {string} callId - Unique call ID
 */
export async function sendCallNotification(fcmToken, callerName, callerId, callType = 'video', callId = null) {
  console.log('🔥 [FCM] sendCallNotification called');
  console.log('🔥 [FCM] initializationAttempted:', initializationAttempted);
  console.log('🔥 [FCM] isInitialized:', isInitialized);
  console.log('🔥 [FCM] admin.apps.length:', admin.apps.length);
  
  if (!initializationAttempted) {
    console.error('❌ [FCM] initializeFCM() was never called!');
    console.error('❌ [FCM] Please restart the server to initialize FCM');
    return { success: false, error: 'FCM initialization never called' };
  }
  
  if (!isInitialized || !admin.apps.length) {
    console.error('❌ [FCM] Firebase Admin not initialized');
    console.error('❌ [FCM] initializationAttempted:', initializationAttempted);
    console.error('❌ [FCM] isInitialized:', isInitialized);
    console.error('❌ [FCM] admin.apps.length:', admin.apps.length);
    return { success: false, error: 'FCM not initialized' };
  }

  if (!fcmToken) {
    console.error('❌ [FCM] No FCM token provided');
    return { success: false, error: 'No FCM token' };
  }

  try {
    const message = {
      token: fcmToken,
      // Use DATA message (not notification) for better control
      data: {
        type: 'incoming_call',
        callId: callId || `call_${Date.now()}`,
        callerId: callerId,
        callerName: callerName,
        callType: callType,
      },
      // Android-specific settings
      android: {
        priority: 'high', // Critical for automatic ringing
        notification: {
          channelId: 'call_notifications',
          sound: 'default',
          priority: 'high',
          visibility: 'public',
        },
      },
      // APNs settings (for iOS if you add it later)
      apns: {
        headers: {
          'apns-priority': '10',
        },
        payload: {
          aps: {
            sound: 'default',
            'content-available': 1,
          },
        },
      },
    };

    console.log('🔥 [FCM] Sending call notification...');
    console.log('🔥 [FCM] To:', fcmToken.substring(0, 20) + '...');
    console.log('🔥 [FCM] Caller:', callerName);

    const response = await admin.messaging().send(message);
    console.log('✅ [FCM] Call notification sent successfully:', response);
    
    return { success: true, messageId: response };
  } catch (error) {
    console.error('❌ [FCM] Error sending call notification:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Check if FCM is initialized
 */
export function isFCMInitialized() {
  return isInitialized && admin.apps.length > 0;
}

/**
 * Get FCM initialization status (for debugging)
 */
export function getFCMStatus() {
  return {
    initializationAttempted,
    isInitialized,
    adminAppsCount: admin.apps.length,
    hasEnvVar: !!process.env.FIREBASE_SERVICE_ACCOUNT,
    envVarLength: process.env.FIREBASE_SERVICE_ACCOUNT?.length || 0
  };
}

/**
 * Send FCM notification to user by MongoDB user ID
 * Looks up the user's FCM token and sends notification
 */
export async function sendCallNotificationToUser(userId, callerName, callerId, callType = 'video', callId = null) {
  try {
    const User = (await import('../models/user.js')).default;
    const user = await User.findById(userId);
    
    if (!user || !user.fcmToken) {
      console.error('❌ [FCM] User not found or no FCM token:', userId);
      return { success: false, error: 'User not found or no FCM token' };
    }

    return await sendCallNotification(
      user.fcmToken,
      callerName,
      callerId,
      callType,
      callId
    );
  } catch (error) {
    console.error('❌ [FCM] Error sending to user:', error);
    return { success: false, error: error.message };
  }
}
