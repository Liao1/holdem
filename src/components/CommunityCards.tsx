import type { Card as CardType } from '../engine/types';
import Card from './Card';

interface CommunityCardsProps {
  cards: CardType[];
}

export default function CommunityCards({ cards }: CommunityCardsProps) {
  return (
    <div className="flex gap-2 justify-center items-center">
      {Array.from({ length: 5 }).map((_, i) => {
        const card = cards[i];
        if (!card) {
          return (
            <div
              key={i}
              className="w-[90px] h-[126px] rounded-md border border-white/10 bg-white/5"
            />
          );
        }
        return (
          <Card
            key={`${card.suit}-${card.rank}`}
            card={card}
            faceUp
            dealing
            delay={i < 3 ? i * 0.15 : 0}
          />
        );
      })}
    </div>
  );
}
