// OneSignal Push Notification Service
// Sends push notifications to mobile app users

const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
const ONESIGNAL_REST_API_KEY = process.env.ONESIGNAL_REST_API_KEY;

if (!ONESIGNAL_APP_ID || !ONESIGNAL_REST_API_KEY) {
  console.error('❌ [OneSignal] Missing ONESIGNAL_APP_ID or ONESIGNAL_REST_API_KEY in environment variables!');
}

/**
 * Send a push notification to a specific user
 * @param {string} userId - MongoDB user ID (linked to OneSignal external_user_id)
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 * @param {object} data - Additional data to send with notification
 * @param {object} images - Optional images: { profilePic, postImage }
 */
async function sendNotificationToUser(userId, title, message, data = {}, images = {}) {
  try {
    console.log('📤 [OneSignal] Preparing notification...');
    console.log('📤 [OneSignal] User ID:', userId);
    console.log('📤 [OneSignal] Title:', title);
    console.log('📤 [OneSignal] Message:', message);
    console.log('📤 [OneSignal] Data:', data);
    console.log('📤 [OneSignal] Images:', images);
    
    // For call notifications, use high priority and full-screen intent
    const isCallNotification = data.type === 'call';
    
    // Facebook-style rich notifications: Use profile picture as large icon, post image as big picture
    const profilePic = images.profilePic || images.largeIcon;
    const postImage = images.postImage || images.bigPicture;
    
    const notification = {
      app_id: ONESIGNAL_APP_ID,
      target_channel: 'push',
      include_aliases: {
        external_id: [userId]
      },
      // Facebook-style notification structure
      headings: { en: title }, // Header: User's name (bold, prominent - like Facebook)
      contents: { en: message }, // Content: Action description
      subtitle: { en: message }, // iOS: Subtitle (same as content)
      data: data,
      // Rich notifications (Facebook-style)
      ...(profilePic && {
        large_icon: profilePic, // Android: Large icon (profile picture) - shows prominently
        ios_attachments: { id: profilePic }, // iOS: Attachment image
      }),
      ...(postImage && {
        big_picture: postImage, // Android: Large image (post image) - expands when notification is opened
      }),
      // Notification sound and vibration (Facebook-style)
      sound: 'default', // Default notification sound
      // Android-specific settings
      android_accent_color: 'FF3B82F6', // Blue accent color (like Facebook)
      android_led_color: 'FF3B82F6', // LED color for notification
      android_sound: 'default', // Android notification sound
      // High priority for call notifications (like WhatsApp)
      priority: isCallNotification ? 10 : undefined,
      // Android-specific settings for call notifications
      android_channel_id: isCallNotification ? 'call_notifications' : undefined,
      // Sound and vibration for calls
      ...(isCallNotification && {
        android_sound: 'default',
        android_led_color: 'FF0000FF',
        android_accent_color: 'FF0000FF',
      }),
    };

    console.log('📤 [OneSignal] Sending request to OneSignal API...');
    console.log('📤 [OneSignal] Notification payload:', JSON.stringify(notification, null, 2));
    console.log('📤 [OneSignal] Using API Key:', ONESIGNAL_REST_API_KEY.substring(0, 20) + '...');

    const response = await fetch('https://api.onesignal.com/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Key ${ONESIGNAL_REST_API_KEY}`,
      },
      body: JSON.stringify(notification),
    });

    console.log('📤 [OneSignal] Response status:', response.status);
    const result = await response.json();
    console.log('📤 [OneSignal] Response body:', JSON.stringify(result, null, 2));
    
    if (result.errors) {
      console.error('❌ [OneSignal] API returned errors:', result.errors);
      return { success: false, error: result.errors };
    }

    console.log('✅ [OneSignal] Push notification sent successfully to user:', userId);
    console.log('✅ [OneSignal] Recipients:', result.recipients);
    return { success: true, data: result };
  } catch (error) {
    console.error('❌ [OneSignal] Error sending push notification:', error);
    console.error('❌ [OneSignal] Error stack:', error.stack);
    return { success: false, error: error.message };
  }
}

/**
 * Send notification when someone likes a post
 * Facebook-style: "John Doe liked your post"
 */
async function sendLikeNotification(postOwnerId, likerName, postId, images = {}) {
  return await sendNotificationToUser(
    postOwnerId,
    likerName, // Header: User's name (like Facebook)
    'liked your post', // Content: Action description
    { type: 'like', postId },
    images
  );
}

/**
 * Send notification when someone comments on a post
 * Facebook-style: "John Doe commented on your post"
 */
async function sendCommentNotification(postOwnerId, commenterName, postId, images = {}) {
  return await sendNotificationToUser(
    postOwnerId,
    commenterName, // Header: User's name (like Facebook)
    'commented on your post', // Content: Action description
    { type: 'comment', postId },
    images
  );
}

/**
 * Send notification when someone follows you
 * Facebook-style: "John Doe started following you"
 */
async function sendFollowNotification(userId, followerName, followerId, images = {}) {
  return await sendNotificationToUser(
    userId,
    followerName, // Header: User's name (like Facebook)
    'started following you', // Content: Action description
    { type: 'follow', userId: followerId },
    images
  );
}

/**
 * Send notification when someone mentions you
 * Facebook-style: "John Doe mentioned you in a post"
 */
async function sendMentionNotification(userId, mentionerName, postId, images = {}) {
  return await sendNotificationToUser(
    userId,
    mentionerName, // Header: User's name (like Facebook)
    'mentioned you in a post', // Content: Action description
    { type: 'mention', postId },
    images
  );
}

/**
 * Send notification for chess challenge
 */
async function sendChessChallengeNotification(userId, challengerName, gameId) {
  return await sendNotificationToUser(
    userId,
    'Chess Challenge ♟️',
    `${challengerName} challenged you to a chess game!`,
    { type: 'chess_challenge', gameId }
  );
}

/**
 * Send notification for chess move
 */
async function sendChessMoveNotification(userId, opponentName, gameId) {
  return await sendNotificationToUser(
    userId,
    'Your Turn ♟️',
    `${opponentName} made a move. It's your turn!`,
    { type: 'chess_move', gameId }
  );
}

/**
 * Send notification when added as contributor
 */
async function sendContributorAddedNotification(userId, ownerName, postId) {
  return await sendNotificationToUser(
    userId,
    'Collaborative Post 👥',
    `${ownerName} added you as a contributor`,
    { type: 'contributor', postId }
  );
}

/**
 * Send notification for weather alert
 */
async function sendWeatherAlertNotification(userId, city, message) {
  return await sendNotificationToUser(
    userId,
    `Weather Alert 🌤️`,
    `${city}: ${message}`,
    { type: 'weather', city }
  );
}

/**
 * Send notification for football score update
 */
async function sendFootballScoreNotification(userId, matchInfo) {
  return await sendNotificationToUser(
    userId,
    'Goal! ⚽',
    matchInfo,
    { type: 'football' }
  );
}

/**
 * Send notification for incoming call
 * Uses FCM ONLY for automatic ringing (WhatsApp-like behavior)
 * FCM is required for automatic ringing when app is closed
 */
async function sendCallNotification(userId, callerName, callerId, callType = 'video') {
  try {
    const { sendCallNotificationToUser } = await import('./fcmNotifications.js');
    const fcmResult = await sendCallNotificationToUser(userId, callerName, callerId, callType);
    
    if (fcmResult.success) {
      console.log('✅ [CallNotification] Sent via FCM (automatic ringing enabled)');
      return fcmResult;
    } else {
      console.error('❌ [CallNotification] FCM failed:', fcmResult.error);
      return { success: false, error: fcmResult.error || 'FCM notification failed' };
    }
  } catch (error) {
    console.error('❌ [CallNotification] Error sending FCM notification:', error);
    console.error('❌ [CallNotification] Error details:', error.message);
    return { success: false, error: error.message || 'Failed to send FCM notification' };
  }
}

/**
 * Send notification for missed call
 */
async function sendMissedCallNotification(userId, callerName, callType = 'video') {
  return await sendNotificationToUser(
    userId,
    'Missed Call 📵',
    `You missed a ${callType} call from ${callerName}`,
    { 
      type: 'missed_call', 
      callType,
      callerName 
    }
  );
}

export {
  sendNotificationToUser,
  sendLikeNotification,
  sendCommentNotification,
  sendFollowNotification,
  sendMentionNotification,
  sendChessChallengeNotification,
  sendChessMoveNotification,
  sendContributorAddedNotification,
  sendWeatherAlertNotification,
  sendFootballScoreNotification,
  sendCallNotification,
  sendMissedCallNotification,
};
