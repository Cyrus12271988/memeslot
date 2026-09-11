"use client";

interface Point {
    col:number;
    row:number;
}

export default function TradingViewTrail({
    coords
}:{
    coords:Point[]
}){

    const CELL_W=100;
    const CELL_H=100;

    const candles=[];

    for(let i=0;i<coords.length-1;i++){

        const a=coords[i];
        const b=coords[i+1];

        const ax=a.col*CELL_W+CELL_W/2;
        const ay=a.row*CELL_H+CELL_H/2;

        const bx=b.col*CELL_W+CELL_W/2;
        const by=b.row*CELL_H+CELL_H/2;

        const dx=bx-ax;
        const dy=by-ay;

        const distance=Math.sqrt(dx*dx+dy*dy);

        const steps=Math.floor(distance/16);

        for(let j=0;j<=steps;j++){

            const t=j/steps;

            candles.push({

                x:ax+dx*t,

                y:ay+dy*t,

                angle:Math.atan2(dy,dx)*180/Math.PI,

                delay:j*25

            });

        }

    }

    return(
<>
{candles.map((c,i)=>(

<g
key={i}
transform={`translate(${c.x},${c.y}) rotate(${c.angle})`}
style={{
animationDelay:`${c.delay}ms`
}}
className="tv-candle"
>

<line
x1="0"
y1="-8"
x2="0"
y2="8"
className="tv-wick"
/>

<rect
x="-3"
y="-5"
width="6"
height="10"
rx="1"
className="tv-body"
/>

</g>

))}
</>
    );

}