export function PipMascot({
  mood = "happy",
  className = "",
}: {
  mood?: "happy" | "thinking" | "cheering" | "celebrating"
  className?: string
}) {
  const happy = mood === "happy"
  const thinking = mood === "thinking"
  const armsUp = mood === "cheering" || mood === "celebrating"

  return (
    <svg
      aria-hidden="true"
      className={`pip-mascot ${className}`}
      viewBox="0 0 180 190"
    >
      {mood === "celebrating" && (
        <g className="pip-confetti">
          <path d="m20 39 9 4-7 6Z" fill="#f6bd49" />
          <path d="m153 30 8-6 3 10Z" fill="#ef806d" />
          <path d="m148 74 11 2-5 8Z" fill="#b7d552" />
          <circle cx="35" cy="78" fill="#8cc6a5" r="5" />
        </g>
      )}
      <ellipse cx="90" cy="174" fill="#173e31" opacity=".13" rx="47" ry="9" />
      <path
        d="M87 49C72 31 74 13 87 8c12 7 16 24 6 40Z"
        fill="#8fbd4e"
        stroke="#234b38"
        strokeWidth="5"
      />
      <path
        d="M91 48c12-19 27-23 38-15-1 14-14 24-34 22Z"
        fill="#b5d75f"
        stroke="#234b38"
        strokeWidth="5"
      />
      <path
        d="M90 50c-1-15-9-25-24-29-7 14 2 29 21 34Z"
        fill="#6ea84e"
        stroke="#234b38"
        strokeWidth="5"
      />
      <path
        d="M56 95c-15-8-25-3-31 9M124 95c15-8 25-3 31 9"
        fill="none"
        stroke="#234b38"
        strokeLinecap="round"
        strokeWidth="8"
        transform={
          armsUp
            ? "rotate(18 56 95)"
            : thinking
              ? "rotate(-9 56 95)"
              : undefined
        }
      />
      <path
        d="M53 112c-2-42 14-66 38-66s41 24 38 66c-2 37-14 56-38 56s-36-19-38-56Z"
        fill="#d8e795"
        stroke="#234b38"
        strokeWidth="6"
      />
      <path
        d="M61 121c4 29 14 42 30 42 17 0 27-14 31-42-15 8-46 8-61 0Z"
        fill="#a9ce65"
        opacity=".7"
      />
      <ellipse cx="73" cy="98" fill="#173e31" rx="8" ry="11" />
      <ellipse cx="109" cy="98" fill="#173e31" rx="8" ry="11" />
      <circle cx="76" cy="94" fill="white" r="3" />
      <circle cx="112" cy="94" fill="white" r="3" />
      <ellipse cx="65" cy="114" fill="#ef8e82" opacity=".75" rx="8" ry="5" />
      <ellipse cx="117" cy="114" fill="#ef8e82" opacity=".75" rx="8" ry="5" />
      {thinking ? (
        <path
          d="M87 119c3-2 6-2 9 0"
          fill="none"
          stroke="#234b38"
          strokeLinecap="round"
          strokeWidth="4"
        />
      ) : (
        <path
          d={happy ? "M82 117c5 7 13 7 18 0" : "M80 116c6 10 15 10 22 0"}
          fill="#fff7dc"
          stroke="#234b38"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="4"
        />
      )}
      <path
        d="M64 148c-7 1-13 5-16 12M118 148c7 1 13 5 16 12"
        fill="none"
        stroke="#234b38"
        strokeLinecap="round"
        strokeWidth="7"
      />
      <path
        d="M115 126v26c-9 8-39 8-48 0v-26"
        fill="#e8a74c"
        stroke="#234b38"
        strokeLinejoin="round"
        strokeWidth="5"
      />
      <path
        d="M67 133c14 6 34 6 48 0M91 134v23"
        fill="none"
        stroke="#234b38"
        strokeWidth="4"
      />
    </svg>
  )
}

export function ForestBackdrop() {
  return (
    <div aria-hidden="true" className="forest-backdrop">
      <span className="glow glow-one" />
      <span className="glow glow-two" />
      <svg className="canopy canopy-left" viewBox="0 0 320 720">
        <path d="M0 0h208c-10 76-59 90-63 159-6 92 66 100 38 191-19 62-92 57-84 140 5 54 38 104 11 230H0Z" />
        <path
          d="M0 52c80 21 107 57 89 108-16 46-55 70-89 74ZM0 363c59-20 106 17 90 69-12 39-50 58-90 56Z"
          opacity=".32"
        />
      </svg>
      <svg className="canopy canopy-right" viewBox="0 0 320 720">
        <path d="M320 0H112c10 76 59 90 63 159 6 92-66 100-38 191 19 62 92 57 84 140-5 54-38 104-11 230h110Z" />
        <path
          d="M320 84c-80 21-107 57-89 108 16 46 55 70 89 74ZM320 398c-59-20-106 17-90 69 12 39 50 58 90 56Z"
          opacity=".32"
        />
      </svg>
    </div>
  )
}


