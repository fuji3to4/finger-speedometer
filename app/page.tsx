'use client'
import FingerSpeed from './components/FingerSpeed'


export default function Page() {
  return (
    <main className="max-w-[960px] mx-auto p-6 safe-p min-h-100svh">
      <h1 className="text-3xl mb-2">Finger Speed Game 🖐️⚡</h1>
      <p className="opacity-80 mb-4">
        人差し指の先（ランドマーク #8）の速度を競うミニゲームです。最高速を目指そう！
      </p>
      <FingerSpeed />
    </main>
  )
}