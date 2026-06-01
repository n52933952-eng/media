import { Track } from 'livekit-client';

export function isScreenSharePublication(pub, track) {
  const src = pub?.source ?? track?.source;
  if (
    src === Track.Source.ScreenShare
    || src === 'screen_share'
    || src === 2
  ) {
    return true;
  }
  const name = String(pub?.trackName ?? track?.name ?? '');
  return /screen/i.test(name);
}

export function isVideoPublication(pub) {
  return pub?.kind === Track.Kind.Video || pub?.kind === 'video';
}

export async function collectRemoteVideoTracks(room) {
  let screen = null;
  let camera = null;

  for (const participant of room.remoteParticipants.values()) {
    const screenPub = participant.getTrackPublication?.(Track.Source.ScreenShare);
    const camPub = participant.getTrackPublication?.(Track.Source.Camera);

    if (screenPub && !screenPub.isSubscribed) {
      try { await screenPub.setSubscribed(true); } catch (_) {}
    }
    if (camPub && !camPub.isSubscribed) {
      try { await camPub.setSubscribed(true); } catch (_) {}
    }

    if (screenPub?.track) screen = screenPub.track;
    if (camPub?.track) camera = camPub.track;
  }

  if (screen && camera) return { screen, camera };

  for (const participant of room.remoteParticipants.values()) {
    for (const pub of participant.trackPublications.values()) {
      if (!isVideoPublication(pub)) continue;
      if (!pub.isSubscribed) {
        try { await pub.setSubscribed(true); } catch (_) {}
      }
      const track = pub.track;
      if (!track) continue;
      if (!screen && isScreenSharePublication(pub, track)) screen = track;
      else if (!camera && !isScreenSharePublication(pub, track)) camera = track;
    }
  }

  return { screen, camera };
}

export function applyRemoteVideoTrack(track, pub, setScreen, setCamera) {
  if (!track || !isVideoPublication(pub)) return;
  if (isScreenSharePublication(pub, track)) setScreen(track);
  else setCamera(track);
}
