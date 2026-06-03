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
import { RoomEvent } from 'livekit-client';
import { useLiveKit } from '../context/LiveKitContext';
import ScreenShareViewer from './ScreenShareViewer';

// ── small helpers ────────────────────────────────────────────────────────────
const HangupIcon = () => <span style={{ fontSize: 20 }}>📵</span>;
const MicIcon = ({ muted }) => <span style={{ fontSize: 18 }}>{muted ? '🔇' : '🎙️'}</span>;
const CamIcon = ({ off }) => <span style={{ fontSize: 18 }}>{off ? '📷' : '📹'}</span>;
const ShareIcon = ({ on }) => <span style={{ fontSize: 18 }}>{on ? '🛑' : '🖥️'}</span>;

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

  const isScreen     = (t) => t?.source === 'screen_share' || t?.track?.source === 'screen_share';
  const remoteScreen = remoteTracks.find(t => t.track.kind === 'video' && isScreen(t));
  const localScreen  = localTracks.find(t => t.kind === 'video' && isScreen(t));
  const remoteCamera = remoteTracks.find(t => t.track.kind === 'video' && !isScreen(t));
  // Remote share first; when you present, your screen is the big view (same as group call).
  const activeScreen = remoteScreen || (isSharing ? localScreen : null);
  const remoteVideo  = activeScreen || remoteCamera;
  const remoteAudio  = remoteTracks.find(t => t.track.kind === 'audio');
  const localVideo   = localTracks.find(t => t.kind   === 'video');
  const remoteVideoRef = useRef(null);
  const remoteCamPipRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteAudioElRef = useRef(null);

  useEffect(() => {
    if (activeScreen || !remoteCamera?.track || !remoteVideoRef.current) return;
    const el = remoteVideoRef.current;
    try { remoteCamera.track.attach(el); } catch (_) {}
    return () => {
      try { remoteCamera.track.detach(el); } catch (_) {}
      if (el) el.srcObject = null;
    };
  }, [activeScreen, remoteCamera]);

  // While someone presents, keep their camera in a small thumbnail.
  useEffect(() => {
    if (!activeScreen || !remoteCamera?.track || !remoteCamPipRef.current) return;
    const el = remoteCamPipRef.current;
    try { remoteCamera.track.attach(el); } catch (_) {}
    return () => {
      try { remoteCamera.track.detach(el); } catch (_) {}
      if (el) el.srcObject = null;
    };
  }, [activeScreen, remoteCamera]);

  useEffect(() => {
    if (!localVideo || !localVideoRef.current) return;
    const el = localVideoRef.current;
    try { localVideo.attach(el); } catch (_) {}
    return () => {
      try { localVideo.detach(el); } catch (_) {}
      if (el) el.srcObject = null;
    };
  }, [localVideo]);

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

  // Screen share — on desktop the browser shows the native "Entire screen / Window / Tab" picker.
  const handleToggleShare = async () => {
    const roomObj = room?.current;
    if (!roomObj?.localParticipant) return;
    const next = !isSharing;
    try {
      await roomObj.localParticipant.setScreenShareEnabled(next);
      setIsSharing(next);
    } catch (_) {
      // User cancelled the browser picker, or it failed.
      setIsSharing(false);
    }
  };

  // Keep the button in sync if the user clicks the browser's own "Stop sharing" bar.
  useEffect(() => {
    const roomObj = room?.current;
    if (!roomObj) return;
    const onUnpub = (pub) => {
      if (pub?.source === 'screen_share') setIsSharing(false);
    };
    roomObj.on(RoomEvent.LocalTrackUnpublished, onUnpub);
    return () => { try { roomObj.off(RoomEvent.LocalTrackUnpublished, onUnpub); } catch (_) {} };
  }, [room, callAccepted]);

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

      {/* Remote video / audio-only placeholder */}
      <Box
        flex={1}
        w="100%"
        position="relative"
        display="flex"
        alignItems="center"
        justifyContent="center"
        px={{ base: 2, md: 6 }}
        py={{ base: 2, md: 4 }}
      >
        {remoteVideo ? (
          activeScreen ? (
            <Box
              position="relative"
              w="100%"
              h="100%"
              maxW="1100px"
              maxH="calc(100vh - 200px)"
              alignSelf="stretch"
              flex={1}
              minH={0}
            >
              <ScreenShareViewer
                track={activeScreen.track}
                name={remoteScreen ? (callPartner?.name || 'User') : 'You'}
                flex="1"
                minH="calc(100vh - 200px)"
                controlsBottom="108px"
              />
            </Box>
          ) : (
            <Box
              position="relative"
              w="100%"
              h="100%"
              maxW="1100px"
              maxH="calc(100vh - 170px)"
              borderRadius={{ base: 'md', md: '2xl' }}
              overflow="hidden"
              bg="black"
              border="1px solid"
              borderColor="whiteAlpha.300"
              boxShadow="0 14px 36px rgba(0,0,0,0.45)"
            >
              <Box
                key={remoteVideo?.track?.sid || 'remote-main'}
                as="video"
                ref={remoteVideoRef}
                autoPlay
                playsInline
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </Box>
          )
        ) : (
          <VStack>
            <Avatar src={callPartner?.profilePic} name={callPartner?.name} size="2xl" />
            <Text color="white" fontWeight="bold" fontSize="xl">{callPartner?.name}</Text>
            <Text color="gray.400">{callType === 'audio' ? 'Voice call' : 'Connecting video…'}</Text>
          </VStack>
        )}
        {/* Remote camera thumbnail (while they present their screen) */}
        {(remoteScreen || (isSharing && localScreen)) && remoteCamera && (
          <Box
            position="absolute"
            bottom={{ base: 118, md: 42 }}
            right={{ base: '132px', md: '172px' }}
            w={{ base: '108px', md: '142px' }}
            h={{ base: '80px', md: '106px' }}
            borderRadius="xl"
            overflow="hidden"
            border="2px solid"
            borderColor="whiteAlpha.500"
            boxShadow="0 6px 20px rgba(0,0,0,0.45)"
            bg="black"
          >
            <Box
              as="video"
              ref={remoteCamPipRef}
              autoPlay
              playsInline
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </Box>
        )}

        {/* Local pip */}
        {localVideo && callType !== 'audio' && (
          <Box
            position="absolute"
            bottom={{ base: 118, md: 42 }}
            right={{ base: 3, md: 5 }}
            w={{ base: '108px', md: '142px' }}
            h={{ base: '80px', md: '106px' }}
            borderRadius="xl"
            overflow="hidden"
            border="2px solid"
            borderColor="whiteAlpha.500"
            boxShadow="0 6px 20px rgba(0,0,0,0.45)"
            bg="black"
          >
            <Box
              as="video"
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </Box>
        )}
      </Box>

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
