// OneSignal Push Notification Service
// Sends push notifications to mobile app users

const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID || '63af553f-4dfb-449d-9f22-38d6e006094b';
const ONESIGNAL_REST_API_KEY = process.env.ONESIGNAL_REST_API_KEY || 'os_v2_app_moxvkp2n7ncj3hzchdloabqjjphqka221zvukimumihykx6461n3w3d2ecv7xh6ey4hualeb62ys4kb41a2fc16juw5bl73jxut7aqy';

/**
 * Send a push notification to a specific user
 * @param {string} userId - MongoDB user ID (linked to OneSignal external_user_id)
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 * @param {object} data - Additional data to send with notification
 */
async function sendNotificationToUser(userId, title, message, data = {}) {
  try {
    console.log('📤 [OneSignal] Preparing notification...');
    console.log('📤 [OneSignal] User ID:', userId);
    console.log('📤 [OneSignal] Title:', title);
    console.log('📤 [OneSignal] Message:', message);
    console.log('📤 [OneSignal] Data:', data);
    
    const notification = {
      app_id: ONESIGNAL_APP_ID,
      target_channel: 'push',
      include_aliases: {
        external_id: [userId]
      },
      headings: { en: title },
      contents: { en: message },
      data: data,
    };

    console.log('📤 [OneSignal] Sending request to OneSignal API...');
    console.log('📤 [OneSignal] Notification payload:', JSON.stringify(notification, null, 2));
    console.log('📤 [OneSignal] Using API Key:', ONESIGNAL_REST_API_KEY.substring(0, 20) + '...');

    const response = await fetch('https://api.onesignal.com/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `key ${ONESIGNAL_REST_API_KEY}`,
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
 */
async function sendLikeNotification(postOwnerId, likerName, postId) {
  return await sendNotificationToUser(
    postOwnerId,
    'New Like ❤️',
    `${likerName} liked your post`,
    { type: 'like', postId }
  );
}

/**
 * Send notification when someone comments on a post
 */
async function sendCommentNotification(postOwnerId, commenterName, postId) {
  return await sendNotificationToUser(
    postOwnerId,
    'New Comment 💬',
    `${commenterName} commented on your post`,
    { type: 'comment', postId }
  );
}

/**
 * Send notification when someone follows you
 */
async function sendFollowNotification(userId, followerName, followerId) {
  return await sendNotificationToUser(
    userId,
    'New Follower 👥',
    `${followerName} started following you`,
    { type: 'follow', userId: followerId }
  );
}

/**
 * Send notification when someone mentions you
 */
async function sendMentionNotification(userId, mentionerName, postId) {
  return await sendNotificationToUser(
    userId,
    'You were mentioned 📣',
    `${mentionerName} mentioned you in a post`,
    { type: 'mention', postId }
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
 */
async function sendCallNotification(userId, callerName, callerId, callType = 'video') {
  const title = callType === 'video' ? 'Incoming Video Call 📹' : 'Incoming Voice Call 📞';
  return await sendNotificationToUser(
    userId,
    title,
    `${callerName} is calling you...`,
    { 
      type: 'call', 
      callType,
      callerId,
      callerName 
    }
  );
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
