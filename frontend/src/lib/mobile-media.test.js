import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  TOTAL_MEDIA_FILES,
  getMediaStatus,
  subscribeMediaStatus,
  initLocalMedia,
  cancelMediaDownload
} from './mobile-media.js'
import { imgSrc, gifSrc, setLocalMediaBases, getLocalMediaBases } from './exercises.js'

describe('mobile-media and exercises media base', () => {
  afterEach(() => {
    setLocalMediaBases(null, null)
  })

  it('reports the correct total media files count', () => {
    expect(TOTAL_MEDIA_FILES).toBe(2648)
  })

  it('provides media status and updates subscribers', () => {
    const status = getMediaStatus()
    expect(status.total).toBe(2648)
    expect(typeof status.status).toBe('string')

    let notified = false
    const unsub = subscribeMediaStatus(() => {
      notified = true
    })
    expect(typeof unsub).toBe('function')
    unsub()
  })

  it('uses default remote or relative paths when no local media is configured', () => {
    const ex = { id: '0001', img: '0001.jpg', gif: '0001.gif' }
    expect(imgSrc(ex)).toContain('0001.jpg')
    expect(gifSrc(ex)).toContain('0001.gif')
  })

  it('switches imgSrc and gifSrc to local media base when set', () => {
    const ex = { id: '0001', img: '0001.jpg', gif: '0001.gif' }
    setLocalMediaBases('http://localhost/_capacitor_file_/data/media/img/', 'http://localhost/_capacitor_file_/data/media/gif/')

    const { localImgBase, localGifBase } = getLocalMediaBases()
    expect(localImgBase).toBe('http://localhost/_capacitor_file_/data/media/img/')
    expect(localGifBase).toBe('http://localhost/_capacitor_file_/data/media/gif/')

    expect(imgSrc(ex)).toBe('http://localhost/_capacitor_file_/data/media/img/0001.jpg')
    expect(gifSrc(ex)).toBe('http://localhost/_capacitor_file_/data/media/gif/0001.gif')
  })

  it('appends trailing slash if omitted in setLocalMediaBases', () => {
    setLocalMediaBases('http://localhost/img', 'http://localhost/gif')
    const ex = { img: 'test.jpg', gif: 'test.gif' }
    expect(imgSrc(ex)).toBe('http://localhost/img/test.jpg')
    expect(gifSrc(ex)).toBe('http://localhost/gif/test.gif')
  })

  it('safely handles cancelMediaDownload when no download is active', () => {
    expect(() => cancelMediaDownload()).not.toThrow()
  })
})
