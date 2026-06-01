/**
 * Host camera pip while live + sharing on home / chess (not on /live/broadcast).
 */

import { useLocation } from 'react-router-dom';
import { useLiveBroadcast } from '../context/LiveBroadcastContext';
import HostCameraPipOverlay from './HostCameraPipOverlay';

const LiveCameraPip = () => {
  const location = useLocation();
  const { isLive, isSharing, localTrack } = useLiveBroadcast();
  const onLivePage = location.pathname === '/live/broadcast';
  const visible = isLive && isSharing && localTrack && !onLivePage;

  if (!visible) return null;

  return <HostCameraPipOverlay track={localTrack} visible />;
};

export default LiveCameraPip;
