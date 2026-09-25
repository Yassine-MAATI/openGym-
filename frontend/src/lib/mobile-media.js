import { useSyncExternalStore } from 'react'
import { EXDB } from './exercises-data.js'
import { setLocalMediaBases } from './exercises.js'
import { MOBILE } from './mobile.js'
import { t } from './i18n.js'

async function showToast(msg) {
  try {
    const { useUI } = await import('../store/useUI.js')
    useUI.getState().toast(msg)
  } catch (e) {}
}

export const TOTAL_MEDIA_FILES = 2648 // 1,324 images + 1,324 gifs
const CDN_IMG_BASE = import.meta.env.VITE_IMG_BASE || 'https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@7455efae41b330c265e7cd4b78dfa848e7ce5ebd/images/'
const CDN_GIF_BASE = import.meta.env.VITE_GIF_BASE || 'https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@7455efae41b330c265e7cd4b78dfa848e7ce5ebd/videos/'

let state = {
  status: 'idle', // 'idle' | 'checking' | 'downloading' | 'completed' | 'error'
  completed: 0,
  total: TOTAL_MEDIA_FILES,
  pct: 0,
  isLocal: false,
  error: null,
  currentFile: '',
}

const listeners = new Set()
function emit() {
  listeners.forEach(fn => fn())
}

export function subscribeMediaStatus(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function getMediaStatus() {
  return state
}

export function useMediaStatus() {
  return useSyncExternalStore(subscribeMediaStatus, getMediaStatus)
}

let activeAbort = null

export async function initLocalMedia() {
  if (!MOBILE) return false
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) return false
    const { Filesystem, Directory } = await import('@capacitor/filesystem')

    // Check if .complete marker exists
    const stat = await Filesystem.stat({ path: 'media/.complete', directory: Directory.Data }).catch(() => null)
    if (stat) {
      const imgUri = await Filesystem.getUri({ path: 'media/img', directory: Directory.Data })
      const gifUri = await Filesystem.getUri({ path: 'media/gif', directory: Directory.Data })
      const imgBase = Capacitor.convertFileSrc(imgUri.uri)
      const gifBase = Capacitor.convertFileSrc(gifUri.uri)
      setLocalMediaBases(imgBase, gifBase)
      state = {
        ...state,
        status: 'completed',
        completed: TOTAL_MEDIA_FILES,
        total: TOTAL_MEDIA_FILES,
        pct: 100,
        isLocal: true,
        error: null,
      }
      emit()
      return true
    }

    // Check partial progress
    const [imgRes, gifRes] = await Promise.all([
      Filesystem.readdir({ path: 'media/img', directory: Directory.Data }).catch(() => ({ files: [] })),
      Filesystem.readdir({ path: 'media/gif', directory: Directory.Data }).catch(() => ({ files: [] })),
    ])
    const count = (imgRes.files?.length || 0) + (gifRes.files?.length || 0)
    if (count > 0) {
      state = {
        ...state,
        status: 'idle',
        completed: Math.min(count, TOTAL_MEDIA_FILES),
        total: TOTAL_MEDIA_FILES,
        pct: Math.min(100, Math.round((count / TOTAL_MEDIA_FILES) * 100)),
        isLocal: false,
        error: null,
      }
      emit()
    }
  } catch (e) {
    console.warn('initLocalMedia failed', e)
  }
  return false
}

export async function startMediaDownload() {
  if (state.status === 'downloading') return
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) {
      showToast(t('Media download is available in the native mobile app on Android/iOS'))
      return
    }
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')

    state = { ...state, status: 'checking', error: null }
    emit()

    await Filesystem.mkdir({ path: 'media/img', directory: Directory.Data, recursive: true }).catch(() => {})
    await Filesystem.mkdir({ path: 'media/gif', directory: Directory.Data, recursive: true }).catch(() => {})

    const [imgRes, gifRes] = await Promise.all([
      Filesystem.readdir({ path: 'media/img', directory: Directory.Data }).catch(() => ({ files: [] })),
      Filesystem.readdir({ path: 'media/gif', directory: Directory.Data }).catch(() => ({ files: [] })),
    ])
    const existingImg = new Set((imgRes.files || []).map(f => (typeof f === 'string' ? f : f.name)))
    const existingGif = new Set((gifRes.files || []).map(f => (typeof f === 'string' ? f : f.name)))

    const tasks = []
    for (const ex of EXDB) {
      if (ex.img && !existingImg.has(ex.img)) {
        tasks.push({ url: CDN_IMG_BASE + ex.img, path: 'media/img/' + ex.img, name: ex.img })
      }
      if (ex.gif && !existingGif.has(ex.gif)) {
        tasks.push({ url: CDN_GIF_BASE + ex.gif, path: 'media/gif/' + ex.gif, name: ex.gif })
      }
    }

    let done = TOTAL_MEDIA_FILES - tasks.length
    if (tasks.length === 0) {
      await Filesystem.writeFile({ path: 'media/.complete', directory: Directory.Data, data: '1', encoding: Encoding.UTF8 })
      await initLocalMedia()
      showToast(t('All exercise media downloaded (~140 MB)'))
      return
    }

    activeAbort = new AbortController()
    state = {
      ...state,
      status: 'downloading',
      completed: done,
      total: TOTAL_MEDIA_FILES,
      pct: Math.round((done / TOTAL_MEDIA_FILES) * 100),
      isLocal: false,
      error: null,
    }
    emit()

    let taskIdx = 0
    let lastEmit = Date.now()
    const CONCURRENCY = 6

    async function worker() {
      while (taskIdx < tasks.length && !activeAbort.signal.aborted) {
        const task = tasks[taskIdx++]
        try {
          await Filesystem.downloadFile({
            url: task.url,
            path: task.path,
            directory: Directory.Data,
          })
          done++
          const now = Date.now()
          if (now - lastEmit > 150) {
            lastEmit = now
            state = {
              ...state,
              completed: done,
              pct: Math.min(100, Math.round((done / TOTAL_MEDIA_FILES) * 100)),
              currentFile: task.name,
            }
            emit()
          }
        } catch (e) {
          console.warn('Failed downloading ' + task.name, e)
        }
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

    if (activeAbort.signal.aborted) {
      state = {
        ...state,
        status: 'idle',
        completed: done,
        pct: Math.round((done / TOTAL_MEDIA_FILES) * 100),
        currentFile: '',
      }
      emit()
      return
    }

    activeAbort = null
    if (done >= TOTAL_MEDIA_FILES - 10) {
      await Filesystem.writeFile({ path: 'media/.complete', directory: Directory.Data, data: '1', encoding: Encoding.UTF8 })
      await initLocalMedia()
      showToast(t('All exercise media downloaded (~140 MB)'))
    } else {
      state = {
        ...state,
        status: 'idle',
        completed: done,
        pct: Math.round((done / TOTAL_MEDIA_FILES) * 100),
        error: t('Download paused or incomplete ({0} files remaining). Tap to resume.', TOTAL_MEDIA_FILES - done),
        currentFile: '',
      }
      emit()
    }
  } catch (e) {
    state = { ...state, status: 'idle', error: e.message || t('Download failed') }
    emit()
  }
}

export function cancelMediaDownload() {
  if (activeAbort) {
    activeAbort.abort()
    activeAbort = null
  }
}

export async function deleteLocalMedia() {
  cancelMediaDownload()
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem')
    await Filesystem.rmdir({ path: 'media', directory: Directory.Data, recursive: true })
  } catch (e) {
    console.warn('deleteLocalMedia error', e)
  }
  setLocalMediaBases(null, null)
  state = {
    status: 'idle',
    completed: 0,
    total: TOTAL_MEDIA_FILES,
    pct: 0,
    isLocal: false,
    error: null,
    currentFile: '',
  }
  emit()
}
