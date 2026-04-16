/**
 * GroupCallUI — WhatsApp-style group video/audio call overlay for web.
 *
 * Shows:
 *  1. Incoming group call ring (all notified members see this)
 *  2. Active call grid — one tile per participant
 *  3. Controls: Mute, Camera, Flip, End
 */

import { useContext, useState, useEffect, useRef } from 'react';
import {
  Box, Flex, Avatar, Text, IconButton, HStack, VStack,
  Badge, SimpleGrid,
} from '@chakra-ui/react';
import { PhoneIcon } from '@chakra-ui/icons';
import { GroupCallContext } from '../context/GroupCallContext';

const HangupIcon = () => <span style={{ fontSize: 20 }}>📵</span>;

// ── Single participant tile ───────────────────────────────────────────────────
const ParticipantTile = ({ participant }) => {
  const videoTrack = [...participant.trackPublications.values()]
    .find(p => p.source === 'camera' && p.track)?.track;
  const audioTrack = [...participant.trackPublications.values()]
    .find(p => p.source === 'microphone' && p.track)?.track;
  const videoRef = useRef(null);
  const audioElRef = useRef(null);

  useEffect(() => {
    if (!videoTrack || !videoRef.current) return;
    const el = videoRef.current;
    try { videoTrack.attach(el); } catch (_) {}
    return () => {
      try { videoTrack.detach(el); } catch (_) {}
      if (el) el.srcObject = null;
    };
  }, [videoTrack]);

  useEffect(() => {
    if (!audioTrack) return;
    try {
      const audioEl = audioTrack.attach();
      audioEl.autoplay = true;
      audioEl.style.display = 'none';
      document.body.appendChild(audioEl);
      if (audioElRef.current) {
        try { audioElRef.current.remove(); } catch (_) {}
      }
      audioElRef.current = audioEl;
    } catch (_) {}
    return () => {
      if (audioElRef.current) {
        try {
          audioTrack.detach(audioElRef.current);
          audioElRef.current.remove();
        } catch (_) {}
        audioElRef.current = null;
      }
    };
  }, [audioTrack]);

  return (
    <Box
      bg="gray.900" borderRadius="xl" overflow="hidden"
      position="relative" minH="160px"
      border="2px solid" borderColor="gray.700"
    >
      {videoTrack ? (
        <Box
          as="video"
          ref={videoRef}
          autoPlay
          playsInline
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <Flex h="100%" minH="160px" alignItems="center" justifyContent="center" bg="gray.800">
          <VStack spacing={1}>
            <Avatar name={participant.name || participant.identity} size="lg" />
            <Text color="gray.400" fontSize="xs">{participant.name || participant.identity}</Text>
          </VStack>
        </Flex>
      )}
      <Box position="absolute" bottom={2} left={2}>
        <Text color="white" fontSize="xs" bg="blackAlpha.600" px={2} py={0.5} borderRadius="md">
          {participant.name || participant.identity}
        </Text>
      </Box>
    </Box>
  );
};

// ── Incoming group call overlay ───────────────────────────────────────────────
const IncomingGroupCallOverlay = () => {
  const { incomingGroupCall, joinGroupCall, declineGroupCall } = useContext(GroupCallContext);
  if (!incomingGroupCall) return null;

  return (
    <Box
      position="fixed" top={0} left={0} right={0} bottom={0}
      bg="blackAlpha.800" zIndex={9999}
      display="flex" alignItems="center" justifyContent="center"
    >
      <VStack
        bg="gray.800" borderRadius="2xl" p={8} spacing={5}
        boxShadow="0 0 40px rgba(0,0,0,0.6)" minW="300px" align="center"
      >
        <Badge colorScheme="green" fontSize="sm" px={3} py={1} borderRadius="full">
          Group {incomingGroupCall.callType === 'audio' ? 'Voice' : 'Video'} Call
        </Badge>
        <Avatar src={incomingGroupCall.callerProfilePic} name={incomingGroupCall.callerName} size="xl" />
        <VStack spacing={0}>
          <Text color="white" fontWeight="bold" fontSize="xl">{incomingGroupCall.callerName}</Text>
          <Text color="gray.400" fontSize="sm">is calling the group…</Text>
        </VStack>
        <HStack spacing={8}>
          <VStack spacing={1}>
            <IconButton icon={<HangupIcon />} colorScheme="red" borderRadius="full" size="lg" onClick={declineGroupCall} aria-label="Decline" />
            <Text color="gray.400" fontSize="sm">Decline</Text>
          </VStack>
          <VStack spacing={1}>
            <IconButton icon={<PhoneIcon />} colorScheme="green" borderRadius="full" size="lg" onClick={joinGroupCall} aria-label="Join" />
            <Text color="gray.400" fontSize="sm">Join</Text>
          </VStack>
        </HStack>
      </VStack>
    </Box>
  );
};

// ── Active group call screen ──────────────────────────────────────────────────
const ActiveGroupCallScreen = () => {
  const { groupCallActive, groupCallType, groupCallRoom, leaveGroupCall, participants } = useContext(GroupCallContext);
  const [isMuted,   setIsMuted]   = useState(false);
  const [isCamOff,  setIsCamOff]  = useState(false);

  if (!groupCallActive) return null;

  const handleMute = async () => {
    if (!groupCallRoom.current) return;
    const next = !isMuted;
    try {
      await groupCallRoom.current.localParticipant.setMicrophoneEnabled(!next);
      setIsMuted(next);
    } catch (_) {}
  };

  const handleCam = async () => {
    if (!groupCallRoom.current) return;
    const next = !isCamOff;
    try {
      await groupCallRoom.current.localParticipant.setCameraEnabled(!next);
      setIsCamOff(next);
    } catch (_) {}
  };

  // Include local participant in grid
  const localParticipant = groupCallRoom.current?.localParticipant;

  return (
    <Box
      position="fixed" top={0} left={0} right={0} bottom={0}
      bg="gray.900" zIndex={9997} display="flex" flexDir="column"
    >
      {/* Header */}
      <Flex px={4} py={3} alignItems="center" justifyContent="space-between" bg="blackAlpha.600">
        <HStack>
          <Badge colorScheme="green">GROUP CALL</Badge>
          <Text color="gray.300" fontSize="sm">{participants.length + 1} participants</Text>
        </HStack>
        <Badge colorScheme={groupCallType === 'audio' ? 'green' : 'purple'}>
          {groupCallType === 'audio' ? '🎙 Voice' : '📹 Video'}
        </Badge>
      </Flex>

      {/* Participant grid */}
      <Box flex={1} overflowY="auto" p={3}>
        <SimpleGrid columns={{ base: 1, sm: 2, md: 3, lg: 4 }} spacing={3}>
          {/* Local tile */}
          {localParticipant && <ParticipantTile participant={localParticipant} />}
          {/* Remote tiles */}
          {participants.map(p => <ParticipantTile key={p.identity} participant={p} />)}
        </SimpleGrid>
      </Box>

      {/* Controls */}
      <HStack justify="center" spacing={4} p={4} bg="blackAlpha.600">
        <VStack spacing={1}>
          <IconButton
            icon={<span style={{ fontSize: 18 }}>{isMuted ? '🔇' : '🎙️'}</span>}
            colorScheme={isMuted ? 'red' : 'gray'} borderRadius="full" size="md"
            onClick={handleMute} aria-label="Mute"
          />
          <Text color="gray.400" fontSize="xs">{isMuted ? 'Unmute' : 'Mute'}</Text>
        </VStack>

        {groupCallType !== 'audio' && (
          <VStack spacing={1}>
            <IconButton
              icon={<span style={{ fontSize: 18 }}>{isCamOff ? '📷' : '📹'}</span>}
              colorScheme={isCamOff ? 'red' : 'gray'} borderRadius="full" size="md"
              onClick={handleCam} aria-label="Camera"
            />
            <Text color="gray.400" fontSize="xs">{isCamOff ? 'Cam On' : 'Cam Off'}</Text>
          </VStack>
        )}

        <VStack spacing={1}>
          <IconButton
            icon={<HangupIcon />} colorScheme="red" borderRadius="full" size="lg"
            onClick={leaveGroupCall} aria-label="Leave"
          />
          <Text color="gray.400" fontSize="xs">Leave</Text>
        </VStack>
      </HStack>
    </Box>
  );
};

// ── Main export ───────────────────────────────────────────────────────────────
const GroupCallUI = () => (
  <>
    <IncomingGroupCallOverlay />
    <ActiveGroupCallScreen />
  </>
);

export default GroupCallUI;
