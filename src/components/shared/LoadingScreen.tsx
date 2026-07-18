// The app-wide gate screen shown while the session is being resolved
// (ProtectedRoute, before `user`/`role` are known). ቁ — the first
// character of "Kuncho" and the sidebar/login brand mark — bounces
// like a dropped ball while flipping a full vertical 360° (rotateX)
// in sync with each bounce, so it "lands" upright every cycle.
export function LoadingScreen() {
  return (
    <div className="flex h-screen items-center justify-center bg-white dark:bg-slate-900">
      <style>{`
        @keyframes ku-loader-bounce {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-2.5rem); }
        }
        @keyframes ku-loader-flip {
          0%   { transform: rotateX(0deg); }
          100% { transform: rotateX(360deg); }
        }
        .ku-loader-bounce {
          animation: ku-loader-bounce 0.9s cubic-bezier(0.45, 0, 0.55, 1) infinite;
        }
        .ku-loader-flip {
          animation: ku-loader-flip 0.9s linear infinite;
          transform-style: preserve-3d;
        }
      `}</style>
      <div className="ku-loader-bounce" style={{ perspective: '600px' }}>
        <div
          className="ku-loader-flip font-black leading-none text-brand select-none"
          style={{ fontSize: '4.5rem' }}
        >
          ቁ
        </div>
      </div>
    </div>
  )
}
