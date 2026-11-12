import { COOKIE_SESSION_KEY } from '../constants/scan'

export function saveCookieSession(cookie) {
  const value = String(cookie || '').trim()
  if (value) sessionStorage.setItem(COOKIE_SESSION_KEY, value)
  else sessionStorage.removeItem(COOKIE_SESSION_KEY)
  return value
}

export function loadCookieSession() {
  return sessionStorage.getItem(COOKIE_SESSION_KEY) || ''
}
