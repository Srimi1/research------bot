import { createEvidenceSearch } from '../core/evidence';
import { fetchNetwork } from './network';

export { parseCrossref } from '../core/evidence';

export const searchEvidence = createEvidenceSearch(fetchNetwork);
