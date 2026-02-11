import type { Position, RangeAction } from './types';

export type PreflopStrategyScenario =
  | 'RFI'
  | 'FACING_RFI'
  | 'RFI_VS_3BET'
  | 'SB_LIMP_VS_BB_RAISE';

export interface PreflopStrategySpot {
  id: string;
  scenario: PreflopStrategyScenario;
  heroPosition: Position;
  openerPositions?: Position[];
  threeBettorPositions?: Position[];
  notes?: string;
  hands: Record<string, RangeAction>;
}

export interface PreflopStrategyFile {
  version: string;
  source: {
    pdf: string;
    extractedAt: string;
    method: string;
    stackDepthBb: number;
  };
  assumptions: {
    handGranularity: '169';
    unknownColorAction: 'FOLD';
    blueIsRaise: true;
    greenIsCall: true;
    darkGrayIsFold: true;
    whiteIsFold: true;
  };
  spots: PreflopStrategySpot[];
}

export interface PreflopStrategyLookupContext {
  scenario: PreflopStrategyScenario;
  heroPosition: Position;
  openerPosition?: Position;
  threeBettorPosition?: Position;
}
