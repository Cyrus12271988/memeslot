"use client";

import ScatterLanding from "./ScatterLanding";

interface Props {
  active: boolean;
  freeSpins: number;
}

export default function BonusIntro({
  active,
  freeSpins,
}: Props) {
  if (!active) return null;

  return (
    <div className="absolute inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <ScatterLanding freeSpins={freeSpins} />
    </div>
  );
}