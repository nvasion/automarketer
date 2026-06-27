/**
 * Media service — uploads images to the server's /api/media endpoint so they
 * are persisted with a stable, publicly-fetchable URL.
 *
 * This replaces ephemeral `URL.createObjectURL` blob URLs, which are local to
 * the browser session, vanish on reload, and cannot be used by the server or
 * by social platforms when publishing.
 */

export interface UploadedMedia {
  /** Server-assigned media id. */
  id: string
  /** Absolute, publicly-fetchable URL (e.g. https://app/api/media/<id>). */
  url: string
}

/** Read a File as a base64 string (without the `data:...;base64,` prefix). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('Unexpected file reader result'))
        return
      }
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

/**
 * Upload a single image file. Resolves to the stored media id and URL.
 *
 * @throws {Error} when the upload is rejected (size, type) or the request fails.
 */
export async function uploadImage(file: File): Promise<UploadedMedia> {
  const dataBase64 = await fileToBase64(file)

  const res = await fetch('/api/media', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: file.name, mimeType: file.type, dataBase64 }),
  })

  let data: { id?: string; url?: string; error?: string }
  try {
    data = await res.json()
  } catch {
    throw new Error(res.ok ? 'Received an invalid response from the server' : 'Image upload failed')
  }

  if (!res.ok || !data.id || !data.url) {
    throw new Error(data.error ?? 'Image upload failed')
  }
  return { id: data.id, url: data.url }
}
