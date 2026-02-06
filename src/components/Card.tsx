import { motion } from 'motion/react';
import type { Card as CardType } from '../engine/types';
import { SUIT_SYMBOLS, RANK_LABELS } from '../engine/constants';
import '../styles/card.css';

interface CardProps {
  card?: CardType;
  faceUp?: boolean;
  dealing?: boolean;
  delay?: number;
  small?: boolean;
}

export default function Card({ card, faceUp = false, dealing = false, delay = 0, small = false }: CardProps) {
  const isRed = card && (card.suit === 'hearts' || card.suit === 'diamonds');
  const colorClass = isRed ? 'card-red' : 'card-black';
  const sizeClass = small ? 'poker-card-sm' : '';

  return (
    <motion.div
      className={`poker-card ${sizeClass}`}
      initial={dealing ? { opacity: 0, scale: 0.3, y: -100 } : {}}
      animate={dealing ? { opacity: 1, scale: 1, y: 0 } : {}}
      transition={{ duration: 0.3, delay }}
    >
      <div className={`poker-card-inner ${faceUp && card ? 'flipped' : ''}`}>
        <div className="poker-card-back" />
        {card && (
          <div className={`poker-card-front ${colorClass}`}>
            <div className="card-corner card-corner-top">
              <span className="card-rank">{RANK_LABELS[card.rank]}</span>
              <span className="card-suit-small">{SUIT_SYMBOLS[card.suit]}</span>
            </div>
            <span className="card-suit-center">{SUIT_SYMBOLS[card.suit]}</span>
            <div className="card-corner card-corner-bottom">
              <span className="card-rank">{RANK_LABELS[card.rank]}</span>
              <span className="card-suit-small">{SUIT_SYMBOLS[card.suit]}</span>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
