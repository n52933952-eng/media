/**
 * Host camera pip while live + sharing on home / chess (not on /live/broadcast).
 */

import { useLocation } from 'react-router-dom';
import { useLiveBroadcast } from '../context/LiveBroadcastContext';
import HostCameraPipHost from './HostCameraPipHost';

const LiveCameraPip = () => {
  const location = useLocation();
  const { isLive, isSharing, localTrack } = useLiveBroadcast();
  const onLivePage = location.pathname === '/live/broadcast';
  const active = isLive && isSharing && localTrack && !onLivePage;

  if (!active) return null;

  return <HostCameraPipHost track={localTrack} active />;
};

export default LiveCameraPip;
