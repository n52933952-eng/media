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

import { useEffect, useRef } from 'react';
import {
  Box, Flex, Avatar, Text, IconButton, HStack, VStack, Badge,
} from '@chakra-ui/react';
import { PhoneIcon } from '@chakra-ui/icons';
import { VideoTrack, AudioTrack } from '@livekit/components-react';
import '@livekit/components-styles';
import { useLiveKit } from '../context/LiveKitContext';

// ── small helpers ────────────────────────────────────────────────────────────
const HangupIcon = () => <span style={{ fontSize: 20 }}>📵</span>;
const MicIcon    = () => <span style={{ fontSize: 20 }}>🎙️</span>;
const CamIcon    = () => <span style={{ fontSize: 20 }}>📹</span>;

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
  const { isCalling, callPartner, leaveCall } = useLiveKit();
  if (!isCalling) return null;

  return (
    <Box
      position="fixed" top={0} left={0} right={0} bottom={0}
      bg="blackAlpha.800" zIndex={9998}
      display="flex" alignItems="center" justifyContent="center"
    >
      <VStack
        bg="gray.800" borderRadius="2xl" p={8} spacing={6}
        boxShadow="0 0 40px rgba(0,0,0,0.6)" minW="300px" align="center"
      >
        <Avatar src={callPartner?.profilePic} name={callPartner?.name} size="xl" />
        <VStack spacing={1}>
          <Text color="white" fontWeight="bold" fontSize="xl">{callPartner?.name}</Text>
          <Text color="gray.400" fontSize="sm" className="lk-calling-pulse">Calling…</Text>
        </VStack>
        <VStack spacing={1}>
          <IconButton
            icon={<HangupIcon />}
            colorScheme="red" borderRadius="full" size="lg"
            onClick={leaveCall}
            aria-label="Cancel call"
          />
          <Text color="gray.400" fontSize="sm">Cancel</Text>
        </VStack>
      </VStack>
    </Box>
  );
};

// ── Active call screen ────────────────────────────────────────────────────────
const ActiveCallScreen = () => {
  const {
    callAccepted, callPartner, callType,
    localTracks, remoteTracks, leaveCall,
  } = useLiveKit();
  if (!callAccepted) return null;

  const remoteVideo  = remoteTracks.find(t => t.track.kind === 'video');
  const remoteAudio  = remoteTracks.find(t => t.track.kind === 'audio');
  const localVideo   = localTracks.find(t => t.kind   === 'video');

  return (
    <Box
      position="fixed" top={0} left={0} right={0} bottom={0}
      bg="black" zIndex={9997}
      display="flex" flexDir="column" alignItems="center" justifyContent="center"
    >
      {/* Remote video / audio-only placeholder */}
      <Box flex={1} w="100%" position="relative" display="flex" alignItems="center" justifyContent="center">
        {remoteVideo ? (
          <VideoTrack
            trackRef={{ participant: remoteVideo.participantId, publication: remoteVideo.track }}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <VStack>
            <Avatar src={callPartner?.profilePic} name={callPartner?.name} size="2xl" />
            <Text color="white" fontWeight="bold" fontSize="xl">{callPartner?.name}</Text>
            <Text color="gray.400">{callType === 'audio' ? 'Voice call' : 'Connecting video…'}</Text>
          </VStack>
        )}
        {remoteAudio && <AudioTrack trackRef={{ publication: remoteAudio.track }} />}

        {/* Local pip */}
        {localVideo && callType !== 'audio' && (
          <Box
            position="absolute" bottom={4} right={4}
            w="120px" h="90px" borderRadius="lg" overflow="hidden"
            border="2px solid" borderColor="whiteAlpha.400"
          >
            <VideoTrack
              trackRef={{ publication: localVideo }}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              local
            />
          </Box>
        )}
      </Box>

      {/* Controls */}
      <HStack spacing={6} p={6}>
        <VStack spacing={1}>
          <IconButton
            icon={<HangupIcon />}
            colorScheme="red" borderRadius="full" size="lg"
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
