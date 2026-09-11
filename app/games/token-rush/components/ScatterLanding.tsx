"use client";

interface Props {
  freeSpins: number;
}

export default function ScatterLanding({ freeSpins }: Props) {
  return (
    <div className="flex flex-col items-center justify-center">

      {/* Animated Rings */}
      <div className="relative flex items-center justify-center">

        <div className="absolute w-56 h-56 rounded-full border border-green-400/30 animate-ping" />

        <div
          className="absolute w-44 h-44 rounded-full border-2 border-green-400"
          style={{
            animation: "pulse 1.5s infinite",
            boxShadow: "0 0 30px #22c55e",
          }}
        />

        {/* Center Coin */}
        <div
          className="
            w-28 h-28
            rounded-full
            bg-gradient-to-br
            from-green-400
            to-green-600
            flex
            items-center
            justify-center
            text-6xl
            shadow-[0_0_50px_#22c55e]
            animate-bounce
          "
        >
          🚀
        </div>

      </div>

      {/* Title */}
      <h1
        className="
          mt-10
          text-6xl
          font-black
          tracking-widest
          text-green-400
        "
        style={{
          textShadow:
            "0 0 15px #22c55e,0 0 35px #22c55e",
        }}
      >
        TOKEN PUMP
      </h1>

      {/* Subtitle */}
      <div
        className="
          mt-5
          text-3xl
          font-bold
          text-white
        "
      >
        {freeSpins} FREE SPINS
      </div>

      {/* Caption */}
      <div
        className="
          mt-3
          text-green-300
          tracking-widest
        "
      >
        MARKET MOMENTUM ACTIVATED
      </div>

    </div>
  );
}