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
    
    // Read service account file using ES modules
    const serviceAccountPath = join(__dirname, '../firebase-service-account.json');
    console.log('🔥 [FCM] Step 2: Service account path:', serviceAccountPath);
    console.log('🔥 [FCM] Step 2: __dirname:', __dirname);
    
    // Check if file exists first
    console.log('🔥 [FCM] Step 3: Reading service account file...');
    const fileContent = readFileSync(serviceAccountPath, 'utf8');
    console.log('🔥 [FCM] Step 3: File read successfully, length:', fileContent.length);
    
    if (!fileContent || fileContent.trim().length === 0) {
      throw new Error('Service account file is empty');
    }
    
    console.log('🔥 [FCM] Step 4: Parsing JSON...');
    const serviceAccount = JSON.parse(fileContent);
    console.log('🔥 [FCM] Step 4: JSON parsed, project_id:', serviceAccount.project_id);
    
    console.log('🔥 [FCM] Step 5: Checking admin apps...');
    console.log('🔥 [FCM] Step 5: admin.apps.length:', admin.apps.length);
    
    if (!admin.apps.length) {
      console.log('🔥 [FCM] Step 6: Initializing Firebase Admin...');
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      isInitialized = true;
      console.log('✅ [FCM] Step 6: Firebase Admin initialized successfully');
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
    console.error('⚠️ [FCM] Make sure firebase-service-account.json exists in backend folder');
    isInitialized = false;
    console.error('❌ [FCM] ========== END ERROR ==========');
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
