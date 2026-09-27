import React, { useContext, useEffect, useState } from 'react'
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  Button,
  Text,
  VStack,
} from '@chakra-ui/react'
import { UserContext } from '../context/UserContext'
import { COUNTRY_OPTIONS } from '../utils/countries'
import useShowToast from '../hooks/useShowToast'
import API_BASE_URL from '../config/api'

const CountryRequiredModal = () => {
  const { user, setUser } = useContext(UserContext)
  const showToast = useShowToast()
  const [saving, setSaving] = useState(false)
  const [checked, setChecked] = useState(false)
  const [serverCountry, setServerCountry] = useState('')

  useEffect(() => {
    if (!user?._id) {
      setChecked(false)
      setServerCountry('')
      return
    }
    const local = String(user.country || '').trim()
    if (local) {
      setServerCountry(local)
      setChecked(true)
      return
    }
    let cancelled = false
    setChecked(false)
    const base = API_BASE_URL || (import.meta.env.PROD ? window.location.origin : 'http://localhost:5000')
    ;(async () => {
      try {
        const res = await fetch(`${base}/api/user/me`, { credentials: 'include' })
        const data = await res.json()
        const country = String(data?.country || '').trim()
        if (cancelled) return
        if (country) {
          setUser((prev) => {
            const next = { ...(prev || {}), ...data, country }
            localStorage.setItem('userInfo', JSON.stringify(next))
            return next
          })
        }
        setServerCountry(country)
      } catch {
        if (!cancelled) setServerCountry('skip')
      } finally {
        if (!cancelled) setChecked(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user?._id, user?.country, setUser])

  const needsCountry = !!user?._id && checked && !serverCountry

  const save = async (country) => {
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
      setServerCountry(country)
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
          <VStack align="stretch" maxH="320px" overflowY="auto" spacing={1}>
            {COUNTRY_OPTIONS.map((c) => (
              <Button
                key={c.name}
                variant="ghost"
                justifyContent="flex-start"
                isDisabled={saving}
                onClick={() => save(c.name)}
              >
                <Text as="span" mr={3} fontSize="xl">{c.flag}</Text>
                {c.name}
              </Button>
            ))}
          </VStack>
        </ModalBody>
      </ModalContent>
    </Modal>
  )
}

export default CountryRequiredModal
