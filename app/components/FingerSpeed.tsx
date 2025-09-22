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
const VEL_SMOOTH = 0.3 // EMA smoothing for 2D velocity (screen space)
const ACC_SMOOTH = 0.35 // EMA smoothing for 2D acceleration (screen space)
const ARROW_TIME = 0.08 // seconds of motion represented by arrow length
const ARROW_MIN = 6 // px
const ARROW_MAX = 160 // px

export default function FingerSpeed() {
    const videoRef = useRef<HTMLVideoElement | null>(null)
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const ctxRef = useRef<CanvasRenderingContext2D | null>(null)

    // MediaPipe / runtime
    const landmarkerRef = useRef<HandLandmarker | null>(null)
    const drawingRef = useRef<DrawingUtils | null>(null)
    const rafRef = useRef<number | null>(null)
    const lastLogRef = useRef<number>(0)
    const logIntervalMs = 10000

    // UI/state
    const [running, setRunning] = useState(false)
    const [mirror, setMirror] = useState(false)
    const [showVelocity, setShowVelocity] = useState(true)
    const [showAcceleration, setShowAcceleration] = useState(true)
    const mirrorRef = useRef(false)
    const showVelRef = useRef(true)
    const showAccRef = useRef(true)
    useEffect(() => {
        mirrorRef.current = mirror
    }, [mirror])
    useEffect(() => {
        showVelRef.current = showVelocity
    }, [showVelocity])
    useEffect(() => {
        showAccRef.current = showAcceleration
    }, [showAcceleration])

    // フレーム毎に更新される値は state ではなく ref に保持（再レンダ不要）
    const fpsRef = useRef(0)
    // worldLandmarks（m 単位）での速度
    const worldSpeedRef = useRef(0)
    const maxWorldRef = useRef(0)
    const indexXYZRef = useRef<XYZ | null>(null)
    // 2D スクリーン空間の速度ベクトル（px/s）
    const vel2DRef = useRef<{ vx: number; vy: number }>({ vx: 0, vy: 0 })
    // 2D スクリーン空間の加速度ベクトル（px/s^2）
    const acc2DRef = useRef<{ ax: number; ay: number }>({ ax: 0, ay: 0 })

    // 前フレーム情報
    const last = useRef<{ t: number; x: number; y: number; z: number } | null>(null)
    const lastWorld = useRef<{ t: number; x: number; y: number; z: number } | null>(null)
    const lastVelRef = useRef<{ t: number; vx: number; vy: number } | null>(null)

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

        // 背景にカメラフレーム描画（必要ならミラー変換）
        ctx.save()
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.save()
        if (mirrorRef.current) {
            ctx.translate(canvas.width, 0)
            ctx.scale(-1, 1)
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

        const now = performance.now()
        const result = landmarker.detectForVideo(video, now)
        const lm: NormalizedLandmark[] | undefined = result.landmarks?.[0]
        const wlm: { x: number; y: number; z: number }[] | undefined = result.worldLandmarks?.[0]

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

            // 正規化座標 (0..1) と z を取得（描画用）
            const p = lm[8] as XYZ
            indexXYZRef.current = { x: p.x, y: p.y, z: p.z }

            // FPS 推定
            const prev = last.current
            if (prev) {
                const dt = (now - prev.t) / 1000
                if (dt > 0) {
                    const instFps = 1 / dt
                    fpsRef.current = fpsRef.current * (1 - FPS_SMOOTH) + instFps * FPS_SMOOTH
                }
            }

            // 速度計算（worldLandmarks：m/s）
            if (wlm && wlm[8]) {
                const prevW = lastWorld.current
                const pw = wlm[8]
                const dt = prevW ? (now - prevW.t) / 1000 : 0
                if (prevW && dt > 0) {
                    const dx = pw.x - prevW.x
                    const dy = pw.y - prevW.y
                    const dz = pw.z - prevW.z
                    const distM = Math.hypot(dx, dy, dz) // meters
                    const vMps = distM / dt
                    worldSpeedRef.current = vMps
                    maxWorldRef.current = Math.max(maxWorldRef.current, vMps)
                }
                lastWorld.current = { t: now, x: pw.x, y: pw.y, z: pw.z }
            } else {
                lastWorld.current = null
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

            // 2D 速度ベクトル（px/s）を算出・平滑化 + 加速度算出
            if (prev) {
                const dt2 = (now - prev.t) / 1000
                if (dt2 > 0) {
                    const rawVx = ((p.x - prev.x) * canvas.width) / dt2
                    const rawVy = ((p.y - prev.y) * canvas.height) / dt2
                    // 平滑化した速度
                    const newVx = vel2DRef.current.vx * (1 - VEL_SMOOTH) + rawVx * VEL_SMOOTH
                    const newVy = vel2DRef.current.vy * (1 - VEL_SMOOTH) + rawVy * VEL_SMOOTH
                    // 加速度（平滑化速度の時間微分）
                    const prevV = lastVelRef.current
                    if (prevV) {
                        const dtv = (now - prevV.t) / 1000
                        if (dtv > 0) {
                            const ax = (newVx - prevV.vx) / dtv
                            const ay = (newVy - prevV.vy) / dtv
                            acc2DRef.current.ax =
                                acc2DRef.current.ax * (1 - ACC_SMOOTH) + ax * ACC_SMOOTH
                            acc2DRef.current.ay =
                                acc2DRef.current.ay * (1 - ACC_SMOOTH) + ay * ACC_SMOOTH
                        }
                    }
                    vel2DRef.current.vx = newVx
                    vel2DRef.current.vy = newVy
                    lastVelRef.current = { t: now, vx: newVx, vy: newVy }
                }
            }

            // 矢印で速度ベクトルを可視化（表示切替対応）
            if (showVelRef.current) {
                const { vx, vy } = vel2DRef.current
                let dx = vx * ARROW_TIME
                let dy = vy * ARROW_TIME
                let len = Math.hypot(dx, dy)
                if (len >= ARROW_MIN) {
                    if (len > ARROW_MAX) {
                        const k = ARROW_MAX / len
                        dx *= k
                        dy *= k
                        len = ARROW_MAX
                    }
                    const tx = cx + dx
                    const ty = cy + dy
                    // 本体
                    ctx.beginPath()
                    ctx.moveTo(cx, cy)
                    ctx.lineTo(tx, ty)
                    ctx.lineWidth = 4
                    ctx.strokeStyle = "#ff5e5b" // velocity: red
                    ctx.setLineDash([])
                    ctx.stroke()
                    // 矢印ヘッド
                    const angle = Math.atan2(dy, dx)
                    const head = 12
                    const a1 = angle + Math.PI * 0.85
                    const a2 = angle - Math.PI * 0.85
                    ctx.beginPath()
                    ctx.moveTo(tx, ty)
                    ctx.lineTo(tx + Math.cos(a1) * head, ty + Math.sin(a1) * head)
                    ctx.moveTo(tx, ty)
                    ctx.lineTo(tx + Math.cos(a2) * head, ty + Math.sin(a2) * head)
                    ctx.lineWidth = 3
                    ctx.stroke()
                }
            }

            // 矢印で加速度ベクトルを可視化（表示切替対応）
            if (showAccRef.current) {
                const { ax, ay } = acc2DRef.current
                // 加速度は距離に直結しないため、T秒で生じる変位 0.5*a*T^2 に対応させる
                let dxA = 0.5 * ax * ARROW_TIME * ARROW_TIME
                let dyA = 0.5 * ay * ARROW_TIME * ARROW_TIME
                let lenA = Math.hypot(dxA, dyA)
                if (lenA >= ARROW_MIN) {
                    if (lenA > ARROW_MAX) {
                        const k = ARROW_MAX / lenA
                        dxA *= k
                        dyA *= k
                        lenA = ARROW_MAX
                    }
                    const txA = cx + dxA
                    const tyA = cy + dyA
                    // 本体（破線・紫）
                    ctx.beginPath()
                    ctx.moveTo(cx, cy)
                    ctx.lineTo(txA, tyA)
                    ctx.lineWidth = 4
                    ctx.strokeStyle = "#9b5de5" // acceleration: purple
                    // ctx.setLineDash([8, 6])
                    ctx.setLineDash([])
                    ctx.stroke()
                    // 矢印ヘッド
                    const angleA = Math.atan2(dyA, dxA)
                    const headA = 12
                    const a1A = angleA + Math.PI * 0.85
                    const a2A = angleA - Math.PI * 0.85
                    ctx.beginPath()
                    ctx.moveTo(txA, tyA)
                    ctx.lineTo(txA + Math.cos(a1A) * headA, tyA + Math.sin(a1A) * headA)
                    ctx.moveTo(txA, tyA)
                    ctx.lineTo(txA + Math.cos(a2A) * headA, tyA + Math.sin(a2A) * headA)
                    ctx.lineWidth = 3
                    ctx.stroke()
                }
            }
        } else {
            last.current = null
            lastVelRef.current = null
        }
        // ミラー変換を解除してから HUD を描画
        ctx.restore()

        // HUD（ref から値を読む）
        const fps = fpsRef.current
        const worldSpeed = worldSpeedRef.current
        const maxWorld = maxWorldRef.current
        const indexXYZ = indexXYZRef.current

        ctx.fillStyle = "rgba(0,0,0,0.4)"
        ctx.fillRect(10, 10, 360, 130)
        ctx.fillStyle = "#e6ecff"
        ctx.font = "16px system-ui, sans-serif"
        ctx.fillText(`FPS: ${fps.toFixed(1)}`, 20, 36)
        ctx.fillText(`Speed (m/s): ${worldSpeed.toFixed(3)}`, 20, 60)
        ctx.fillText(`Max (m/s): ${maxWorld.toFixed(3)}`, 20, 84)
        if (indexXYZ) {
            ctx.fillText(
                `Index (x,y,z): ${indexXYZ.x.toFixed(3)}, ${indexXYZ.y.toFixed(3)}, ${indexXYZ.z.toFixed(3)}`,
                20,
                132
            )
        }

        ctx.restore()

        rafRef.current = requestAnimationFrame(detectLoop)
    }, []) // 依存なしで安定化（描画値は ref から取得）

    const init = useCallback(async () => {
        if (running) return
        const video = videoRef.current!
        const canvas = canvasRef.current!
        ctxRef.current = canvas.getContext("2d")

        // 開始時にメトリクスをリセット
    fpsRef.current = 0
    worldSpeedRef.current = 0
    maxWorldRef.current = 0
    indexXYZRef.current = null
    vel2DRef.current = { vx: 0, vy: 0 }
    acc2DRef.current = { ax: 0, ay: 0 }
    last.current = null
    lastWorld.current = null
    lastVelRef.current = null

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
    }, [running, detectLoop])

    // Stop/Disconnect
    const stop = useCallback(() => {
        if (rafRef.current) {
            cancelAnimationFrame(rafRef.current)
            rafRef.current = null
        }
        landmarkerRef.current?.close?.()
        landmarkerRef.current = null
        const videoEl = videoRef.current
        const stream = videoEl?.srcObject as MediaStream | undefined
        stream?.getTracks().forEach((t) => t.stop())
        if (videoEl) videoEl.srcObject = null
        setRunning(false)
        last.current = null

        // 画面もクリア
        const ctx = ctxRef.current
        const canvas = canvasRef.current
        if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height)
    }, [])

    const reset = () => {
        maxWorldRef.current = 0
    }

    // クリーンアップ
    useEffect(() => {
        return () => {
            stop()
        }
    }, [stop])

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
                        onClick={stop}
                        disabled={!running}
                        className="py-2 px-3.5 rounded-xl border border-[#2a3358] bg-[#172041] text-[#e6ecff]"
                    >
                        Stop Camera
                    </button>
                    <button
                        onClick={reset}
                        className="py-2 px-3.5 rounded-xl border border-[#2a3358] bg-[#172041] text-[#e6ecff]"
                    >
                        Reset Highscore
                    </button>
                    <label className="inline-flex items-center gap-2 select-none text-[#304ba5] ml-2">
                        <input
                            type="checkbox"
                            checked={mirror}
                            onChange={(e) => setMirror(e.target.checked)}
                            className="accent-[#21d19f] h-4 w-4"
                        />
                        Mirror
                    </label>
                </div>

                <div className="relative w-full max-w-[960px]">
                    <video ref={videoRef} autoPlay playsInline muted className="hidden" />
                    <canvas
                        ref={canvasRef}
                        className="w-full rounded-2xl shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
                    />
                </div>

                <div className="flex items-center gap-4 text-[#304ba5]">
                    <label className="inline-flex items-center gap-2 select-none">
                        <input
                            type="checkbox"
                            checked={showVelocity}
                            onChange={(e) => setShowVelocity(e.target.checked)}
                            className="accent-[#ff5e5b] h-4 w-4"
                        />
                        速度ベクトル
                    </label>
                    <label className="inline-flex items-center gap-2 select-none">
                        <input
                            type="checkbox"
                            checked={showAcceleration}
                            onChange={(e) => setShowAcceleration(e.target.checked)}
                            className="accent-[#9b5de5] h-4 w-4"
                        />
                        加速度ベクトル
                    </label>
                </div>

                <p className="opacity-80">
                    提示: 画面中央で手をはっきり映してから、素早く動かして最高速を狙ってください。背景コントラストが高いほど検出が安定します。
                </p>
            </div>
        </>
    )
}