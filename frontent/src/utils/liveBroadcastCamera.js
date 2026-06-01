import { Track, VideoPresets } from 'livekit-client';

/** Keep camera capture for host preview; viewers only get screen while sharing. */
export async function prepareCameraForScreenShare(room) {
  let pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
  if (!pub?.track) {
    await room.localParticipant.setCameraEnabled(true, {
      resolution: VideoPresets.h360.resolution,
    });
    pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
  }
  if (pub && !pub.isMuted) {
    await pub.mute();
  }
}

/** Camera full-screen for viewers again after screen share stops. */
export async function restoreCameraForViewers(room) {
  let pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
  if (!pub?.track) {
    await room.localParticipant.setCameraEnabled(true, {
      resolution: VideoPresets.h360.resolution,
    });
    pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
  }
  if (pub?.isMuted) {
    await pub.unmute();
  }
  await room.localParticipant.setCameraEnabled(true, {
    resolution: VideoPresets.h360.resolution,
  });
}
