import { Track, VideoPresets } from 'livekit-client';

const CAM_LIVE = VideoPresets.h360.resolution;

/**
 * Unpublish camera for viewers but keep capture for host preview (stopOnUnpublish: false).
 */
export async function prepareCameraForScreenShare(room) {
  let pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
  if (!pub?.track) {
    await room.localParticipant.setCameraEnabled(true, {
      resolution: VideoPresets.h360.resolution,
    });
    pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
  }
  const track = pub?.track;
  if (!track) return null;
  if (pub) {
    await room.localParticipant.unpublishTrack(track, false);
  }
  return track;
}

/** Publish camera again for viewers after screen share stops. */
export async function restoreCameraForViewers(room, previewTrack) {
  const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
  if (pub?.track) {
    if (pub.isMuted) await pub.unmute();
    await room.localParticipant.setCameraEnabled(true, { resolution: CAM_LIVE });
    return;
  }
  if (previewTrack) {
    await room.localParticipant.publishTrack(previewTrack, {
      source: Track.Source.Camera,
      simulcast: true,
    });
    return;
  }
  await room.localParticipant.setCameraEnabled(true, { resolution: CAM_LIVE });
}
