import { Track } from 'livekit-client';

/** True for screen-share publications (web + mobile publishers). */
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

/** Subscribe to all remote video pubs and return screen + camera tracks. */
export async function collectRemoteVideoTracks(room) {
  let screen = null;
  let camera = null;

  for (const participant of room.remoteParticipants.values()) {
    for (const pub of participant.trackPublications.values()) {
      if (!isVideoPublication(pub)) continue;
      if (!pub.isSubscribed) {
        try { await pub.setSubscribed(true); } catch (_) {}
      }
      const track = pub.track;
      if (!track) continue;
      if (isScreenSharePublication(pub, track)) screen = track;
      else camera = track;
    }
  }

  return { screen, camera };
}

export function applyRemoteVideoTrack(track, pub, setScreen, setCamera) {
  if (!track || !isVideoPublication(pub)) return;
  if (isScreenSharePublication(pub, track)) setScreen(track);
  else setCamera(track);
}
