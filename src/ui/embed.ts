import { createContext, useContext } from 'react';

/**
 * Set by the report viewer when a plot is embedded in another page (#...&embed): plots then use
 * a compact layout (options in one menu, notes and secondary lists collapsed) so they stay short
 * on phones.
 */
export const EmbedContext = createContext<{ compact: boolean }>({ compact: false });
export const useCompact = () => useContext(EmbedContext).compact;
