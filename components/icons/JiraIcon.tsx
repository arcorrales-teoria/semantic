export default function JiraIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path
        d="M11.92 0 5.83 6.09a1.97 1.97 0 0 0 0 2.79l4.47 4.47 6.24-6.24a1.97 1.97 0 0 0 0-2.79L13.71.31a1.33 1.33 0 0 0-1.79-.31Z"
        fill="url(#ji-g1)"
      />
      <path
        d="M5.83 7.12 0 13.21a1.97 1.97 0 0 0 0 2.79l4.47 4.47 6.24-6.24-4.88-7.11Z"
        fill="url(#ji-g2)"
      />
      <path
        d="M11.92 0 5.83 6.09a1.97 1.97 0 0 0 0 2.79l4.47 4.47 6.24-6.24a1.97 1.97 0 0 0 0-2.79L13.71.31a1.33 1.33 0 0 0-1.79-.31Z"
        fill="url(#ji-g3)"
        opacity=".4"
      />
      <defs>
        <linearGradient id="ji-g1" x1="16.7" y1="2.97" x2="11.27" y2="8.4" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2684FF" /><stop offset="1" stopColor="#0052CC" />
        </linearGradient>
        <linearGradient id="ji-g2" x1="4.58" y1="9.4" x2="10.85" y2="15.5" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2684FF" /><stop offset="1" stopColor="#0052CC" />
        </linearGradient>
        <linearGradient id="ji-g3" x1="16.7" y1="2.97" x2="11.27" y2="8.4" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2684FF" /><stop offset="1" stopColor="#0052CC" />
        </linearGradient>
      </defs>
    </svg>
  )
}
