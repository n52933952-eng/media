/**
 * LiveKitCallUI — drop-in replacement for the old WebRTC call UI in MessagesPage.
 *
 * Renders:
 *  1. Incoming call overlay  (ring + answer / decline)
 *  2. Active call screen     (local + remote video/audio + end button)
 *  3. Outgoing ringing UI    (calling… + cancel)
 *
 * Uses @livekit/components-react for track rendering — no manual <video> wiring.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Box, Flex, Avatar, Text, IconButton, HStack, VStack, Badge,
} from '@chakra-ui/react';
import { PhoneIcon } from '@chakra-ui/icons';
import { RoomEvent, Track } from 'livekit-client';
import { useLiveKit } from '../context/LiveKitContext';
import ScreenShareViewer from './ScreenShareViewer';
import DraggableCallPip from './DraggableCallPip';
import CallVideoFrame from './CallVideoFrame';

// ── small helpers ────────────────────────────────────────────────────────────
const HangupIcon = () => <span style={{ fontSize: 20 }}>📵</span>;
const MicIcon = ({ muted }) => <span style={{ fontSize: 18 }}>{muted ? '🔇' : '🎙️'}</span>;
const CamIcon = ({ off }) => <span style={{ fontSize: 18 }}>{off ? '📷' : '📹'}</span>;
const ShareIcon = ({ on }) => <span style={{ fontSize: 18 }}>{on ? '🛑' : '🖥️'}</span>;

const isScreenSource = (src) =>
  src === Track.Source.ScreenShare || src === 'screen_share';

const findRemoteCamera = (remoteTracks) =>
  remoteTracks.find((t) => {
    const track = t.track;
    const src = t.source ?? track?.source;
    return track?.kind === 'video' && !isScreenSource(src);
  });

const CameraTileLabel = ({ children }) => (
  <Badge
    position="absolute"
    top={2}
    left={2}
    zIndex={3}
    colorScheme="blackAlpha"
    borderRadius="md"
    fontSize="10px"
    px={2}
  >
    {children}
  </Badge>
);

// ── Incoming call overlay ─────────────────────────────────────────────────────
const IncomingCallOverlay = () => {
  const { incomingCall, answerCall, declineCall } = useLiveKit();
  if (!incomingCall) return null;

  return (
    <Box
      position="fixed" top={0} left={0} right={0} bottom={0}
      bg="blackAlpha.800" zIndex={9999}
      display="flex" alignItems="center" justifyContent="center"
    >
      <VStack
        bg="gray.800" borderRadius="2xl" p={8} spacing={6}
        boxShadow="0 0 40px rgba(0,0,0,0.6)" minW="300px" align="center"
      >
        <Avatar src={incomingCall.callerProfilePic} name={incomingCall.callerName} size="xl" />
        <VStack spacing={1}>
          <Text color="white" fontWeight="bold" fontSize="xl">{incomingCall.callerName}</Text>
          <Badge colorScheme={incomingCall.callType === 'audio' ? 'green' : 'purple'}>
            Incoming {incomingCall.callType === 'audio' ? 'Voice' : 'Video'} Call
          </Badge>
        </VStack>

        <HStack spacing={8}>
          {/* Decline */}
          <VStack spacing={1}>
            <IconButton
              icon={<HangupIcon />}
              colorScheme="red" borderRadius="full" size="lg"
              onClick={declineCall}
              aria-label="Decline call"
            />
            <Text color="gray.400" fontSize="sm">Decline</Text>
          </VStack>

          {/* Answer */}
          <VStack spacing={1}>
            <IconButton
              icon={<PhoneIcon />}
              colorScheme="green" borderRadius="full" size="lg"
              onClick={answerCall}
              aria-label="Answer call"
            />
            <Text color="gray.400" fontSize="sm">Answer</Text>
          </VStack>
        </HStack>
      </VStack>
    </Box>
  );
};

// ── Outgoing / ringing UI ─────────────────────────────────────────────────────
const OutgoingCallOverlay = () => {
  const { isCalling, callPartner, leaveCall, callType, localTracks } = useLiveKit();
  if (!isCalling) return null;
  const localVideo = localTracks.find(t => t.kind === 'video');
  const localVideoRef = useRef(null);

  useEffect(() => {
    if (!localVideo || !localVideoRef.current) return;
    const el = localVideoRef.current;
    try { localVideo.attach(el); } catch (_) {}
    return () => {
      try { localVideo.detach(el); } catch (_) {}
      if (el) el.srcObject = null;
    };
  }, [localVideo]);

  return (
    <Box
      position="fixed" top={0} left={0} right={0} bottom={0}
      bg="blackAlpha.900" zIndex={9998}
      display="flex" alignItems="center" justifyContent="center"
    >
      <Box
        bg="gray.900"
        borderRadius="2xl"
        p={4}
        boxShadow="0 0 40px rgba(0,0,0,0.6)"
        w={{ base: '92vw', md: '460px' }}
        maxW="460px"
      >
        <VStack spacing={4} align="stretch">
          {/* Caller self preview for video calls */}
          {callType === 'video' ? (
            <Box
              h={{ base: '280px', md: '320px' }}
              borderRadius="xl"
              overflow="hidden"
              bg="black"
              position="relative"
              border="1px solid"
              borderColor="whiteAlpha.300"
            >
              {localVideo ? (
                <Box
                  as="video"
                  ref={localVideoRef}
                  autoPlay
                  muted
                  playsInline
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <Flex h="100%" alignItems="center" justifyContent="center">
                  <Text color="gray.400" fontSize="sm">Opening camera…</Text>
                </Flex>
              )}

              <Badge
                position="absolute"
                top={3}
                left={3}
                colorScheme="purple"
                borderRadius="full"
                px={2}
                py={1}
              >
                Video Call
              </Badge>
            </Box>
          ) : null}

          <Flex alignItems="center" gap={3}>
            <Avatar src={callPartner?.profilePic} name={callPartner?.name} size="md" />
            <VStack spacing={0} align="flex-start" flex={1}>
              <Text color="white" fontWeight="bold" fontSize="lg">{callPartner?.name}</Text>
              <Text color="gray.400" fontSize="sm" className="lk-calling-pulse">
                Calling…
              </Text>
            </VStack>
          </Flex>

          <Flex justifyContent="center" pt={1}>
            <VStack spacing={1}>
              <IconButton
                icon={<HangupIcon />}
                colorScheme="red"
                borderRadius="full"
                size="lg"
                onClick={leaveCall}
                aria-label="Cancel call"
              />
              <Text color="gray.400" fontSize="sm">Cancel</Text>
            </VStack>
          </Flex>
        </VStack>
      </Box>
    </Box>
  );
};

// ── Active call screen ────────────────────────────────────────────────────────
const ActiveCallScreen = () => {
  const {
    callAccepted, callPartner, callType,
    localTracks, remoteTracks, leaveCall, room,
  } = useLiveKit();
  if (!callAccepted) return null;
  const [isMuted, setIsMuted] = useState(false);
  const [isCamOff, setIsCamOff] = useState(callType === 'audio');
  const [isSharing, setIsSharing] = useState(false);

  const remoteScreen = remoteTracks.find((t) => {
    const src = t.source ?? t.track?.source;
    return t.track?.kind === 'video' && isScreenSource(src);
  });
  const remoteCamera = findRemoteCamera(remoteTracks);
  const activeScreen = remoteScreen || null;
  const isVideoCall = callType !== 'audio';
  /** Side-by-side cameras when not presenting (always show you + them). */
  const showDualCameras = isVideoCall && !activeScreen && !isSharing;
  const showCameraPips = isVideoCall && (activeScreen || isSharing);
  const remoteCamSid = remoteCamera?.track?.sid ?? '';
  const remoteAudio = remoteTracks.find((t) => t.track?.kind === 'audio');

  const [localCamTrack, setLocalCamTrack] = useState(null);
  const localCamSid = localCamTrack?.sid ?? '';

  const remoteAudioElRef = useRef(null);

  useEffect(() => {
    const roomObj = room?.current;
    if (!roomObj || !callAccepted) return undefined;
    const syncLocalCam = () => {
      const pub = roomObj.localParticipant.getTrackPublication(Track.Source.Camera);
      setLocalCamTrack(pub?.track ?? null);
      requestAnimationFrame(() => {
        const p = roomObj.localParticipant.getTrackPublication(Track.Source.Camera);
        setLocalCamTrack(p?.track ?? null);
      });
    };
    syncLocalCam();
    roomObj.on(RoomEvent.LocalTrackPublished, syncLocalCam);
    roomObj.on(RoomEvent.LocalTrackUnpublished, syncLocalCam);
    return () => {
      roomObj.off(RoomEvent.LocalTrackPublished, syncLocalCam);
      roomObj.off(RoomEvent.LocalTrackUnpublished, syncLocalCam);
    };
  }, [room, callAccepted, isCamOff]);

  useEffect(() => {
    if (!remoteAudio?.track) return;
    try {
      const audioEl = remoteAudio.track.attach();
      audioEl.autoplay = true;
      audioEl.style.display = 'none';
      document.body.appendChild(audioEl);
      if (remoteAudioElRef.current) {
        try { remoteAudioElRef.current.remove(); } catch (_) {}
      }
      remoteAudioElRef.current = audioEl;
    } catch (_) {}
    return () => {
      if (remoteAudioElRef.current) {
        try {
          remoteAudio.track.detach(remoteAudioElRef.current);
          remoteAudioElRef.current.remove();
        } catch (_) {}
        remoteAudioElRef.current = null;
      }
    };
  }, [remoteAudio]);

  useEffect(() => {
    if (callType === 'audio') {
      setIsCamOff(true);
    }
  }, [callType]);

  const handleToggleMute = async () => {
    const roomObj = room?.current;
    if (!roomObj?.localParticipant) return;
    const nextMuted = !isMuted;
    try {
      await roomObj.localParticipant.setMicrophoneEnabled(!nextMuted);
      setIsMuted(nextMuted);
    } catch (_) {}
  };

  const handleToggleCam = async () => {
    if (callType === 'audio') return;
    const roomObj = room?.current;
    if (!roomObj?.localParticipant) return;
    const nextCamOff = !isCamOff;
    try {
      await roomObj.localParticipant.setCameraEnabled(!nextCamOff);
      setIsCamOff(nextCamOff);
    } catch (_) {}
  };

  const syncLocalCamFromRoom = () => {
    const roomObj = room?.current;
    if (!roomObj?.localParticipant) return;
    const pub = roomObj.localParticipant.getTrackPublication(Track.Source.Camera);
    setLocalCamTrack(pub?.track ?? null);
  };

  // Screen share — on desktop the browser shows the native "Entire screen / Window / Tab" picker.
  const handleToggleShare = async () => {
    const roomObj = room?.current;
    if (!roomObj?.localParticipant) return;
    const next = !isSharing;
    try {
      await roomObj.localParticipant.setScreenShareEnabled(next);
      setIsSharing(next);
      if (!next && !isCamOff) {
        await roomObj.localParticipant.setCameraEnabled(true);
        syncLocalCamFromRoom();
        requestAnimationFrame(syncLocalCamFromRoom);
        setTimeout(syncLocalCamFromRoom, 120);
        setTimeout(syncLocalCamFromRoom, 450);
      }
      setRemoteTracks((prev) => {
        const nextRemote = [];
        roomObj.remoteParticipants.forEach((participant) => {
          participant.trackPublications.forEach((pub) => {
            if (pub.track) {
              nextRemote.push({
                track: pub.track,
                participantId: participant.identity,
                source: pub.source || pub.track?.source,
              });
            }
          });
        });
        return nextRemote.length > 0 ? nextRemote : prev;
      });
    } catch (_) {
      setIsSharing(false);
    }
  };

  // Keep the button in sync if the user clicks the browser's own "Stop sharing" bar.
  useEffect(() => {
    const roomObj = room?.current;
    if (!roomObj) return;
    const onUnpub = async (pub) => {
      if (pub?.source !== 'screen_share' && pub?.source !== Track.Source.ScreenShare) return;
      setIsSharing(false);
      if (!isCamOff) {
        try {
          await roomObj.localParticipant.setCameraEnabled(true);
          syncLocalCamFromRoom();
          setTimeout(syncLocalCamFromRoom, 120);
          setTimeout(syncLocalCamFromRoom, 450);
        } catch (_) {}
      }
    };
    roomObj.on(RoomEvent.LocalTrackUnpublished, onUnpub);
    return () => { try { roomObj.off(RoomEvent.LocalTrackUnpublished, onUnpub); } catch (_) {} };
  }, [room, callAccepted, isCamOff]);

  /** After screen share ends, re-enable camera if UI still shows "Starting your camera…". */
  useEffect(() => {
    if (isSharing || isCamOff || !callAccepted) return;
    const roomObj = room?.current;
    if (!roomObj?.localParticipant) return;
    if (localCamTrack) return;
    let cancelled = false;
    (async () => {
      try {
        await roomObj.localParticipant.setCameraEnabled(true);
        if (!cancelled) syncLocalCamFromRoom();
      } catch (_) {}
    })();
    return () => { cancelled = true; };
  }, [isSharing, isCamOff, callAccepted, room, localCamTrack]);

  return (
    <Box
      position="fixed" top={0} left={0} right={0} bottom={0}
      bg="blackAlpha.900" zIndex={9997}
      display="flex" flexDir="column"
    >
      {/* Top info bar */}
      <Flex
        px={4}
        py={3}
        alignItems="center"
        justifyContent="space-between"
        bg="blackAlpha.500"
        borderBottom="1px solid"
        borderColor="whiteAlpha.200"
      >
        <HStack spacing={3}>
          <Avatar src={callPartner?.profilePic} name={callPartner?.name} size="sm" />
          <VStack spacing={0} align="flex-start">
            <Text color="white" fontWeight="bold" fontSize="sm">{callPartner?.name || 'User'}</Text>
            <Text color="gray.300" fontSize="xs">{callType === 'audio' ? 'Voice call' : 'Video call'}</Text>
          </VStack>
        </HStack>
        <Badge colorScheme={callType === 'audio' ? 'green' : 'purple'} borderRadius="full">
          Live
        </Badge>
      </Flex>

      {/* Main stage — same flex layout as group call when screen sharing */}
      <Flex
        flex={1}
        direction="column"
        minH={0}
        w="100%"
        position="relative"
        p={activeScreen ? 3 : undefined}
        gap={activeScreen ? 0 : undefined}
      >
        {isSharing && !activeScreen ? (
          <Flex flex={1} align="center" justify="center" px={6}>
            <VStack spacing={2} textAlign="center">
              <Text color="white" fontWeight="bold" fontSize="lg">You are sharing your screen</Text>
              <Text color="gray.400" fontSize="sm">
                Others can see your screen. Pick a window or tab other than this call to avoid a mirror effect.
              </Text>
            </VStack>
          </Flex>
        ) : activeScreen ? (
          <ScreenShareViewer
            track={activeScreen.track}
            name={callPartner?.name || 'User'}
            controlsBottom="108px"
          />
        ) : showDualCameras ? (
          <Flex
            flex={1}
            direction={{ base: 'column', md: 'row' }}
            gap={3}
            px={{ base: 2, md: 4 }}
            py={2}
            minH={0}
            w="100%"
            maxW="1200px"
            alignSelf="center"
          >
            <Box
              flex={1}
              minH={{ base: '220px', md: 0 }}
              minW={0}
              position="relative"
              borderRadius="xl"
              overflow="hidden"
              border="1px solid"
              borderColor="whiteAlpha.300"
              bg="black"
            >
              <CameraTileLabel>{callPartner?.name || 'User'}</CameraTileLabel>
              {remoteCamera?.track ? (
                <CallVideoFrame track={remoteCamera.track} trackKey={`remote-${remoteCamSid}`} />
              ) : (
                <Flex h="100%" align="center" justify="center" minH="200px">
                  <VStack>
                    <Avatar src={callPartner?.profilePic} name={callPartner?.name} size="lg" />
                    <Text color="gray.400" fontSize="sm">Waiting for their camera…</Text>
                  </VStack>
                </Flex>
              )}
            </Box>
            <Box
              flex={1}
              minH={{ base: '220px', md: 0 }}
              minW={0}
              maxW={{ md: '420px' }}
              position="relative"
              borderRadius="xl"
              overflow="hidden"
              border="1px solid"
              borderColor="whiteAlpha.300"
              bg="black"
            >
              <CameraTileLabel>You</CameraTileLabel>
              {localCamTrack ? (
                <CallVideoFrame track={localCamTrack} trackKey={`local-${localCamSid}`} muted />
              ) : (
                <Flex h="100%" align="center" justify="center" minH="200px">
                  <Text color="gray.400" fontSize="sm">
                    {isCamOff ? 'Camera off' : 'Starting your camera…'}
                  </Text>
                </Flex>
              )}
            </Box>
          </Flex>
        ) : (
          <Flex flex={1} align="center" justify="center">
            <VStack>
              <Avatar src={callPartner?.profilePic} name={callPartner?.name} size="2xl" />
              <Text color="white" fontWeight="bold" fontSize="xl">{callPartner?.name}</Text>
              <Text color="gray.400">{callType === 'audio' ? 'Voice call' : 'Connecting video…'}</Text>
            </VStack>
          </Flex>
        )}
        {showCameraPips && remoteCamera?.track && (
          <DraggableCallPip
            label={callPartner?.name || 'User'}
            defaultRight={168}
            defaultBottom={118}
            width={128}
            height={96}
          >
            <CallVideoFrame track={remoteCamera.track} trackKey={`pip-remote-${remoteCamSid}`} />
          </DraggableCallPip>
        )}

        {showCameraPips && (
          <DraggableCallPip label="You" defaultRight={16} defaultBottom={118} width={128} height={96}>
            {localCamTrack ? (
              <CallVideoFrame track={localCamTrack} trackKey={`pip-local-${localCamSid}`} muted />
            ) : (
              <Flex h="100%" align="center" justify="center" bg="gray.900">
                <Text color="gray.500" fontSize="xs">{isCamOff ? 'Cam off' : 'No camera'}</Text>
              </Flex>
            )}
          </DraggableCallPip>
        )}
      </Flex>

      {/* Controls */}
      <HStack
        spacing={{ base: 5, md: 8 }}
        gap={{ base: 3, md: 5 }}
        px={{ base: 4, md: 8 }}
        py={6}
        justifyContent="center"
        flexWrap="wrap"
        bg="blackAlpha.550"
        borderTop="1px solid"
        borderColor="whiteAlpha.200"
      >
        <VStack spacing={1} minW="64px" align="center">
          <IconButton
            icon={<MicIcon muted={isMuted} />}
            colorScheme={isMuted ? 'red' : 'gray'}
            borderRadius="full"
            size="lg"
            onClick={handleToggleMute}
            aria-label={isMuted ? 'Unmute' : 'Mute'}
          />
          <Text color="gray.400" fontSize="xs">{isMuted ? 'Unmute' : 'Mute'}</Text>
        </VStack>

        {callType !== 'audio' && (
          <VStack spacing={1} minW="64px" align="center">
            <IconButton
              icon={<CamIcon off={isCamOff} />}
              colorScheme={isCamOff ? 'red' : 'gray'}
              borderRadius="full"
              size="lg"
              onClick={handleToggleCam}
              aria-label={isCamOff ? 'Turn camera on' : 'Turn camera off'}
            />
            <Text color="gray.400" fontSize="xs">{isCamOff ? 'Cam On' : 'Cam Off'}</Text>
          </VStack>
        )}

        <VStack spacing={1} minW="64px" align="center">
          <IconButton
            icon={<ShareIcon on={isSharing} />}
            colorScheme={isSharing ? 'teal' : 'gray'}
            borderRadius="full"
            size="lg"
            onClick={handleToggleShare}
            aria-label={isSharing ? 'Stop sharing' : 'Share screen'}
          />
          <Text color="gray.400" fontSize="xs">{isSharing ? 'Stop' : 'Share'}</Text>
        </VStack>

        <VStack spacing={1} minW="64px" align="center">
          <IconButton
            icon={<HangupIcon />}
            colorScheme="red"
            borderRadius="full"
            size="lg"
            onClick={leaveCall}
            aria-label="End call"
          />
          <Text color="gray.400" fontSize="xs">End</Text>
        </VStack>
      </HStack>
    </Box>
  );
};

// ── Main export: renders all three overlays ───────────────────────────────────
const LiveKitCallUI = () => (
  <>
    <IncomingCallOverlay />
    <OutgoingCallOverlay />
    <ActiveCallScreen />
  </>
);

export default LiveKitCallUI;
