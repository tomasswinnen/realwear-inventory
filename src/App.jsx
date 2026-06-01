import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Skeleton } from './components/Skeleton';

const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
const Forecast = lazy(() => import('./pages/Forecast').then(m => ({ default: m.Forecast })));
const Locations = lazy(() => import('./pages/Locations').then(m => ({ default: m.Locations })));
const ItemForecast = lazy(() => import('./pages/ItemForecast').then(m => ({ default: m.ItemForecast })));
const POHistory = lazy(() => import('./pages/POHistory').then(m => ({ default: m.POHistory })));
const ReorderAlerts = lazy(() => import('./pages/ReorderAlerts').then(m => ({ default: m.ReorderAlerts })));

function PageFallback() {
  return (
    <div className="space-y-4 p-1">
      <Skeleton className="h-7 w-48" />
      <div className="grid grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-lg" />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Suspense fallback={<PageFallback />}><Dashboard /></Suspense>} />
            <Route path="forecast" element={<Suspense fallback={<PageFallback />}><Forecast /></Suspense>} />
            <Route path="locations" element={<Suspense fallback={<PageFallback />}><Locations /></Suspense>} />
            <Route path="item/:sku" element={<Suspense fallback={<PageFallback />}><ItemForecast /></Suspense>} />
            <Route path="po-history" element={<Suspense fallback={<PageFallback />}><POHistory /></Suspense>} />
            <Route path="reorder" element={<Suspense fallback={<PageFallback />}><ReorderAlerts /></Suspense>} />
          </Route>
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
