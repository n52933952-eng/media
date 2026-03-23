// Push notifications for PlaySocial — FCM (social / messages / missed call tray).
// Incoming call ringing uses ./fcmNotifications.js directly (data-only); do not change that path here.

/**
 * Send a push notification to a specific user (FCM).
 * @param {string} userId - MongoDB user ID
 * @param {string} title - Notification title
 * @param {string} message - Notification body
 * @param {object} data - Additional data (stringified for FCM)
 * @param {object} images - Optional images: { profilePic, postImage }
 */
async function sendNotificationToUser(userId, title, message, data = {}, images = {}) {
  try {
    const { sendGeneralPushNotificationToUser } = await import('./fcmNotifications.js');
    const result = await sendGeneralPushNotificationToUser(userId, title, message, data, images);
    if (result.success) {
      console.log('✅ [Push/FCM] Sent to user:', userId);
    } else {
      console.warn('⚠️ [Push/FCM] Not sent:', userId, result.error);
    }
    return result;
  } catch (error) {
    console.error('❌ [Push/FCM] Error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send notification when someone likes a post
 */
async function sendLikeNotification(postOwnerId, likerName, postId, images = {}) {
  return await sendNotificationToUser(
    postOwnerId,
    likerName,
    'liked your post',
    { type: 'like', postId },
    images
  );
}

/**
 * Send notification when someone comments on a post
 */
async function sendCommentNotification(postOwnerId, commenterName, postId, images = {}) {
  return await sendNotificationToUser(
    postOwnerId,
    commenterName,
    'commented on your post',
    { type: 'comment', postId },
    images
  );
}

/**
 * Send notification when someone follows you
 */
async function sendFollowNotification(userId, followerName, followerId, images = {}) {
  return await sendNotificationToUser(
    userId,
    followerName,
    'started following you',
    { type: 'follow', userId: followerId },
    images
  );
}

/**
 * Send notification when someone mentions you
 */
async function sendMentionNotification(userId, mentionerName, postId, images = {}) {
  return await sendNotificationToUser(
    userId,
    mentionerName,
    'mentioned you in a post',
    { type: 'mention', postId },
    images
  );
}

/**
 * Send notification when someone sends you a message (when you're offline / not in app)
 */
async function sendMessageNotification(recipientUserId, senderUser, conversationId) {
  const senderName = senderUser?.name || senderUser?.username || 'Someone';
  return await sendNotificationToUser(
    recipientUserId,
    senderName,
    'sent you a message',
    {
      type: 'message',
      conversationId: String(conversationId || ''),
      senderId: senderUser?._id?.toString?.() ?? String(senderUser?._id || ''),
      senderName: senderUser?.name || '',
      senderUsername: senderUser?.username || '',
      senderProfilePic: senderUser?.profilePic || '',
    },
    { profilePic: senderUser?.profilePic }
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
    { type: 'chess_challenge', gameId: String(gameId || '') }
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
    { type: 'chess_move', gameId: String(gameId || '') }
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
    { type: 'contributor', postId: String(postId || '') }
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
    { type: 'weather', city: String(city || '') }
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
 * Send notification for incoming call — FCM data-only (native ringing). Unchanged contract.
 */
async function sendCallNotification(userId, callerName, callerId, callType = 'video') {
  try {
    const { sendCallNotificationToUser } = await import('./fcmNotifications.js');
    const fcmResult = await sendCallNotificationToUser(userId, callerName, callerId, callType);

    if (fcmResult.success) {
      console.log('✅ [CallNotification] Sent via FCM (automatic ringing enabled)');
      return fcmResult;
    }
    console.error('❌ [CallNotification] FCM failed:', fcmResult.error);
    return { success: false, error: fcmResult.error || 'FCM notification failed' };
  } catch (error) {
    console.error('❌ [CallNotification] Error sending FCM notification:', error);
    return { success: false, error: error.message || 'Failed to send FCM notification' };
  }
}

/**
 * Send notification for missed call (tray notification via general FCM)
 */
async function sendMissedCallNotification(userId, callerName, callType = 'video') {
  return await sendNotificationToUser(
    userId,
    'Missed Call 📵',
    `You missed a ${callType} call from ${callerName}`,
    {
      type: 'missed_call',
      callType: String(callType || 'video'),
      callerName: String(callerName || ''),
    }
  );
}

export {
  sendNotificationToUser,
  sendLikeNotification,
  sendCommentNotification,
  sendFollowNotification,
  sendMentionNotification,
  sendMessageNotification,
  sendChessChallengeNotification,
  sendChessMoveNotification,
  sendContributorAddedNotification,
  sendWeatherAlertNotification,
  sendFootballScoreNotification,
  sendCallNotification,
  sendMissedCallNotification,
};
