"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import {
    FilesetResolver,
    HandLandmarker,
    DrawingUtils,
    type NormalizedLandmark,
} from "@mediapipe/tasks-vision"

type XYZ = { x: number; y: number; z: number }

const FPS_SMOOTH = 0.25 // EMA smoothing for fps estimate

export default function FingerSpeed() {
    const videoRef = useRef<HTMLVideoElement | null>(null)
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const ctxRef = useRef<CanvasRenderingContext2D | null>(null)

    // MediaPipe Tasks instances
    const landmarkerRef = useRef<HandLandmarker | null>(null)
    const drawingRef = useRef<DrawingUtils | null>(null)
    const rafRef = useRef<number | null>(null)
    const lastLogRef = useRef<number>(0)
    const logIntervalMs = 1000 // 出力間隔

    // UI/state
    const [running, setRunning] = useState(false)
    const [normSpeed, setNormSpeed] = useState(0)
    const [pxSpeed, setPxSpeed] = useState(0)
    const [maxNorm, setMaxNorm] = useState(0)
    const [maxPx, setMaxPx] = useState(0)
    const [fps, setFps] = useState(0)
    const [indexXYZ, setIndexXYZ] = useState<XYZ | null>(null) // 最新の人差し指先端

    // 前フレーム情報
    const last = useRef<{ t: number; x: number; y: number; z: number } | null>(
        null
    )

    const detectLoop = useCallback(() => {
        const canvas = canvasRef.current
        const ctx = ctxRef.current
        const video = videoRef.current
        const landmarker = landmarkerRef.current
        if (!canvas || !ctx || !video || !landmarker) return

        // canvas サイズ同期
        if (
            canvas.width !== video.videoWidth ||
            canvas.height !== video.videoHeight
        ) {
            canvas.width = video.videoWidth
            canvas.height = video.videoHeight
        }

        // 背景にカメラフレーム描画
        ctx.save()
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

        const now = performance.now()
        const result = landmarker.detectForVideo(video, now)
        const lm: NormalizedLandmark[] | undefined = result.landmarks?.[0]

        // 定期ログ（毎 logIntervalMs ミリ秒）
        if (now - lastLogRef.current > logIntervalMs) {
            // ここでMediaPipeの生の出力を覗く
            // NOTE: 出力量が多くなるので間引いています
            // eslint-disable-next-line no-console
            console.log("[HandLandmarker]", {
                time: now.toFixed(1),
                videoSize: { w: video.videoWidth, h: video.videoHeight },
                hasLandmarks: Boolean(result.landmarks?.length),
                landmarks0: result.landmarks?.[0]?.slice(0, 5),
                world0: result.worldLandmarks?.[0]?.slice(0, 3),
            })
            lastLogRef.current = now
        }

        if (lm && lm[8]) {
            // ランドマーク描画
            if (!drawingRef.current) drawingRef.current = new DrawingUtils(ctx)
            try {
                // 接続線とランドマークを描画
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const CONNS = (HandLandmarker as any).HAND_CONNECTIONS ?? []
                drawingRef.current.drawConnectors(lm, CONNS, {
                    lineWidth: 3,
                    color: "#3ad1ff",
                })
                drawingRef.current.drawLandmarks(lm, {
                    lineWidth: 1,
                    radius: 3,
                    color: "#ffe08a",
                })
            } catch {
                // DrawingUtils API 互換が無い環境でも落ちないように
            }

            // 正規化座標 (0..1) と z を取得
            const p = lm[8] as XYZ
            setIndexXYZ({ x: p.x, y: p.y, z: p.z })

            // FPS 推定
            const prev = last.current
            if (prev) {
                const dt = (now - prev.t) / 1000
                if (dt > 0) {
                    const instFps = 1 / dt
                    setFps((f) => f * (1 - FPS_SMOOTH) + instFps * FPS_SMOOTH)
                }
            }

            // 速度計算（正規化単位/秒 → px/秒換算）
            if (prev) {
                const dx = p.x - prev.x
                const dy = p.y - prev.y
                const dz = p.z - prev.z
                const distNorm = Math.hypot(dx, dy, dz)
                const dt = (now - prev.t) / 1000
                if (dt > 0) {
                    const vNorm = distNorm / dt
                    setNormSpeed(vNorm)
                    setMaxNorm((m) => (vNorm > m ? vNorm : m))

                    const vPx = vNorm * Math.hypot(canvas.width, canvas.height)
                    setPxSpeed(vPx)
                    setMaxPx((m) => (vPx > m ? vPx : m))
                }
            }

            last.current = { t: now, x: p.x, y: p.y, z: p.z }

            // 先端を強調
            const cx = p.x * canvas.width
            const cy = p.y * canvas.height
            ctx.beginPath()
            ctx.arc(cx, cy, 10, 0, Math.PI * 2)
            ctx.lineWidth = 3
            ctx.strokeStyle = "#21d19f"
            ctx.stroke()
        } else {
            last.current = null
        }

        // HUD
        ctx.fillStyle = "rgba(0,0,0,0.4)"
        ctx.fillRect(10, 10, 360, 130)
        ctx.fillStyle = "#e6ecff"
        ctx.font = "16px system-ui, sans-serif"
        ctx.fillText(`FPS: ${fps.toFixed(1)}`, 20, 36)
        ctx.fillText(`Speed (norm): ${normSpeed.toFixed(3)} /s`, 20, 60)
        ctx.fillText(`Speed (px/s): ${pxSpeed.toFixed(0)}`, 20, 84)
        ctx.fillText(
            `Max (norm): ${maxNorm.toFixed(3)} | Max (px/s): ${maxPx.toFixed(0)}`,
            20,
            108
        )
        if (indexXYZ) {
            ctx.fillText(
                `Index (x,y,z): ${indexXYZ.x.toFixed(3)}, ${indexXYZ.y.toFixed(3)}, ${indexXYZ.z.toFixed(3)}`,
                20,
                132
            )
        }

        ctx.restore()

        rafRef.current = requestAnimationFrame(detectLoop)
    }, [fps, normSpeed, pxSpeed, maxNorm, maxPx, indexXYZ])

    const init = useCallback(async () => {
        if (running) return
        const video = videoRef.current!
        const canvas = canvasRef.current!
        ctxRef.current = canvas.getContext("2d")

        // WASM とモデルをCDNからロード
        const vision = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
        )
        const handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath:
                    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
            },
            numHands: 1,
            runningMode: "VIDEO",
        minHandDetectionConfidence: 0.6,
        minTrackingConfidence: 0.6,
        })
        landmarkerRef.current = handLandmarker

        // カメラ開始
        const stream = await navigator.mediaDevices.getUserMedia({ video: true })
        video.srcObject = stream
        // video のメタデータ読み込みを待つ（サイズ 0 対策）
        if (video.readyState < 2 || video.videoWidth === 0) {
            await new Promise<void>((resolve) => {
                const onMeta = () => {
                    // eslint-disable-next-line no-console
                    console.log("[Video] metadata loaded", video.videoWidth, video.videoHeight)
                    video.removeEventListener("loadedmetadata", onMeta)
                    resolve()
                }
                video.addEventListener("loadedmetadata", onMeta)
            })
        }
        await video.play()
        // eslint-disable-next-line no-console
        console.log("[Camera] started")

        setRunning(true)
        detectLoop()
    }, [detectLoop, running])

    const reset = () => {
        setMaxNorm(0)
        setMaxPx(0)
    }

    // クリーンアップ
    useEffect(() => {
        const videoEl = videoRef.current
        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current)
            landmarkerRef.current?.close?.()
            const stream = videoEl?.srcObject as MediaStream | undefined
            stream?.getTracks().forEach((t) => t.stop())
        }
    }, [])

    return (
            <>
                <div className="grid gap-3">
                    <div className="flex items-center gap-3">
                    <button
                        onClick={init}
                        disabled={running}
                            className="py-2 px-3.5 rounded-xl border border-[#2a3358] bg-[#172041] text-[#e6ecff]"
                    >
                        {running ? "Running…" : "Start Camera"}
                    </button>
                    <button
                        onClick={reset}
                            className="py-2 px-3.5 rounded-xl border border-[#2a3358] bg-[#172041] text-[#e6ecff]"
                    >
                        Reset Highscore
                    </button>
                </div>

                    <div className="relative w-full max-w-[960px]">
                        <video ref={videoRef} autoPlay playsInline muted className="hidden" />
                    <canvas
                        ref={canvasRef}
                            className="w-full rounded-2xl shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
                    />
                </div>

                    <p className="opacity-80">
                    提示: 画面中央で手をはっきり映してから、素早く動かして最高速を狙ってください。背景コントラストが高いほど検出が安定します。
                </p>
            </div>
        </>
    )
}