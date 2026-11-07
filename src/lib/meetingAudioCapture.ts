
export type AudioSource = 'you' | 'others'

export type MeetingAudioChunk = {
  source: AudioSource
  blob: Blob
  mimeType: string
  capturedAt: string
}

type CaptureOptions = {
  onChunk: (chunk: MeetingAudioChunk) => void
  onCaptureEnded?: () => void
  onError?: (message: string) => void
}

export type MeetingAudioCaptureController = {
  stop: () => Promise<void>
}

const CHUNK_DURATION_MS = 20_000

function getSupportedMimeType(): string | undefined {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
  ]

  return candidates.find((type) =>
    MediaRecorder.isTypeSupported(type),
  )
}

function stopTracks(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop())
}

function createRecorderLoop(
  stream: MediaStream,
  source: AudioSource,
  mimeType: string | undefined,
  onChunk: (chunk: MeetingAudioChunk) => void,
  onError?: (message: string) => void,
) {
  let stopped = false
  let recorder: MediaRecorder | null = null
  let timeoutId: number | undefined

  function startNextRecording() {
    if (stopped) return

    try {
      const currentRecorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      )

      recorder = currentRecorder

      const recordedParts: Blob[] = []

      currentRecorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) {
          recordedParts.push(event.data)
        }
      })

      currentRecorder.addEventListener('stop', () => {
        const blob = new Blob(recordedParts, {
          type: currentRecorder.mimeType || mimeType || 'audio/webm',
        })

        if (blob.size > 0) {
          onChunk({
            source,
            blob,
            mimeType: blob.type,
            capturedAt: new Date().toISOString(),
          })
        }

        if (!stopped) {
          startNextRecording()
        }
      })

      currentRecorder.addEventListener('error', () => {
        onError?.(
          `The ${source} audio recorder encountered an error.`,
        )
      })

      currentRecorder.start()

      timeoutId = window.setTimeout(() => {
        if (currentRecorder.state === 'recording') {
          currentRecorder.stop()
        }
      }, CHUNK_DURATION_MS)
    } catch {
      stopped = true
      onError?.(
        `Could not start recording the ${source} audio stream.`,
      )
    }
  }

  startNextRecording()

  return {
    stop: (): Promise<void> => {
      if (stopped) return Promise.resolve()

      stopped = true

      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId)
      }

      const currentRecorder = recorder

      if (!currentRecorder || currentRecorder.state === 'inactive') {
        return Promise.resolve()
      }

      return new Promise((resolve) => {
        currentRecorder.addEventListener(
          'stop',
          () => resolve(),
          { once: true },
        )

        currentRecorder.stop()
      })
    },
  }
}

export async function startMeetingAudioCapture(
  options: CaptureOptions,
): Promise<MeetingAudioCaptureController> {
  if (
    !navigator.mediaDevices?.getDisplayMedia ||
    !navigator.mediaDevices?.getUserMedia
  ) {
    throw new Error(
      'Audio capture is unavailable. Use a supported desktop browser over HTTPS.',
    )
  }

  if (typeof MediaRecorder === 'undefined') {
    throw new Error(
      'This browser does not support audio recording.',
    )
  }

  let displayStream: MediaStream | null = null
  let microphoneStream: MediaStream | null = null

  try {
    displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    })

    const displayAudioTracks = displayStream.getAudioTracks()

    if (displayAudioTracks.length === 0) {
      throw new Error(
        'No meeting-tab audio was shared. Select a browser tab and enable "Share tab audio".',
      )
    }

    displayStream.getVideoTracks().forEach((track) => {
      track.stop()
    })

    microphoneStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })

    if (microphoneStream.getAudioTracks().length === 0) {
      throw new Error('No microphone audio track was available.')
    }

    const mimeType = getSupportedMimeType()

    let manuallyStopping = false

    const handleUnexpectedEnd = () => {
      if (!manuallyStopping) {
        options.onCaptureEnded?.()
      }
    }

    displayAudioTracks.forEach((track) => {
      track.addEventListener('ended', handleUnexpectedEnd, {
        once: true,
      })
    })

    microphoneStream.getAudioTracks().forEach((track) => {
      track.addEventListener('ended', handleUnexpectedEnd, {
        once: true,
      })
    })

    const tabRecorder = createRecorderLoop(
      displayStream,
      'others',
      mimeType,
      options.onChunk,
      options.onError,
    )

    const microphoneRecorder = createRecorderLoop(
      microphoneStream,
      'you',
      mimeType,
      options.onChunk,
      options.onError,
    )

    return {
      stop: async () => {
        if (manuallyStopping) return

        manuallyStopping = true

        await Promise.all([
          tabRecorder.stop(),
          microphoneRecorder.stop(),
        ])

        stopTracks(displayStream)
        stopTracks(microphoneStream)
      },
    }
  } catch (error) {
    stopTracks(displayStream)
    stopTracks(microphoneStream)

    if (error instanceof Error) {
      throw error
    }

    throw new Error(
      'Could not start meeting audio capture.',
      { cause: error },
    )
  }
}
