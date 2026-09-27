import React, { useContext, useMemo, useState } from 'react'
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  Select,
  Button,
  Text,
} from '@chakra-ui/react'
import { UserContext } from '../context/UserContext'
import { COUNTRIES } from '../utils/countries'
import useShowToast from '../hooks/useShowToast'
import API_BASE_URL from '../config/api'

const CountryRequiredModal = () => {
  const { user, setUser } = useContext(UserContext)
  const showToast = useShowToast()
  const [country, setCountry] = useState('')
  const [saving, setSaving] = useState(false)

  const needsCountry = useMemo(
    () => !!user?._id && !String(user.country || '').trim(),
    [user?._id, user?.country],
  )

  const save = async () => {
    if (!user?._id || !country || saving) return
    setSaving(true)
    try {
      const base = API_BASE_URL || (import.meta.env.PROD ? window.location.origin : 'http://localhost:5000')
      const res = await fetch(`${base}/api/user/update/${user._id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ country }),
      })
      const data = await res.json()
      if (data.error) {
        showToast('Error', data.error, 'error')
        return
      }
      const next = { ...user, ...data, country }
      localStorage.setItem('userInfo', JSON.stringify(next))
      setUser(next)
      window.dispatchEvent(new Event('discover-country-set'))
    } catch (e) {
      showToast('Error', e?.message || 'Could not save country', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={needsCountry} onClose={() => {}} isCentered closeOnOverlayClick={false} closeOnEsc={false}>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Select your country</ModalHeader>
        <ModalBody pb={6}>
          <Text fontSize="sm" color="gray.500" mb={3}>
            So you can see people and posts near you.
          </Text>
          <Select
            placeholder="Select country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            mb={4}
          >
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
          <Button colorScheme="blue" w="100%" isLoading={saving} isDisabled={!country} onClick={save}>
            Continue
          </Button>
        </ModalBody>
      </ModalContent>
    </Modal>
  )
}

export default CountryRequiredModal
