'use client';

import type { DataUIPart } from 'ai';
import type React from 'react';
import { createContext, useContext, useMemo, useState } from 'react';
import type { CustomUIDataTypes } from '@/lib/types';

type DataStreamState = DataUIPart<CustomUIDataTypes>[];

const DataStreamStateContext = createContext<DataStreamState | null>(null);
// Split state and dispatch contexts so setter consumers don't re-render with every stream update.
const DataStreamDispatchContext = createContext<React.Dispatch<
  React.SetStateAction<DataStreamState>
> | null>(null);

export function DataStreamProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [dataStream, setDataStream] = useState<DataStreamState>([]);

  return (
    <DataStreamStateContext.Provider value={dataStream}>
      <DataStreamDispatchContext.Provider value={setDataStream}>
        {children}
      </DataStreamDispatchContext.Provider>
    </DataStreamStateContext.Provider>
  );
}

export function useDataStream() {
  const dataStream = useDataStreamState();
  const setDataStream = useDataStreamDispatch();
  return useMemo(
    () => ({ dataStream, setDataStream }),
    [dataStream, setDataStream]
  );
}

export function useDataStreamState() {
  const context = useContext(DataStreamStateContext);
  if (context === null) {
    throw new Error(
      'useDataStreamState must be used within a DataStreamProvider'
    );
  }
  return context;
}

export function useDataStreamDispatch() {
  const context = useContext(DataStreamDispatchContext);
  if (context === null) {
    throw new Error(
      'useDataStreamDispatch must be used within a DataStreamProvider'
    );
  }
  return context;
}
