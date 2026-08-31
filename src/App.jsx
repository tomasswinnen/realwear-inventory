import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Skeleton } from './components/Skeleton';
import { Login } from './pages/Login';
import { UpdatePassword } from './pages/UpdatePassword';
import { useAuth } from './hooks/useAuth';

const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
const Forecast = lazy(() => import('./pages/Forecast').then(m => ({ default: m.Forecast })));
const Locations = lazy(() => import('./pages/Locations').then(m => ({ default: m.Locations })));
const ItemForecast = lazy(() => import('./pages/ItemForecast').then(m => ({ default: m.ItemForecast })));
const POHistory = lazy(() => import('./pages/POHistory').then(m => ({ default: m.POHistory })));
const ReorderAlerts = lazy(() => import('./pages/ReorderAlerts').then(m => ({ default: m.ReorderAlerts })));
const OpenTransferOrders = lazy(() => import('./pages/TransferOrders').then(m => ({ default: m.TransferOrders })));
const OnOrder = lazy(() => import('./pages/OnOrder').then(m => ({ default: m.OnOrder })));
const DistributorStock = lazy(() => import('./pages/DistributorStock').then(m => ({ default: m.DistributorStock })));
const SalesPipeline = lazy(() => import('./pages/SalesPipeline').then(m => ({ default: m.SalesPipeline })));
const DistributorScorecard = lazy(() => import('./pages/DistributorScorecard').then(m => ({ default: m.DistributorScorecard })));
const Backlog = lazy(() => import('./pages/Backlog').then(m => ({ default: m.Backlog })));
const LeadTimes = lazy(() => import('./pages/LeadTimes').then(m => ({ default: m.LeadTimes })));
const Margins = lazy(() => import('./pages/Margins').then(m => ({ default: m.Margins })));
const Trends = lazy(() => import('./pages/Trends').then(m => ({ default: m.Trends })));
const Serials = lazy(() => import('./pages/Serials').then(m => ({ default: m.Serials })));
const SoHistory = lazy(() => import('./pages/SoHistory').then(m => ({ default: m.SoHistory })));
const Pepsi = lazy(() => import('./pages/Pepsi').then(m => ({ default: m.Pepsi })));

function PageFallback() {
  return (
    <div className="space-y-4 p-1">
      <Skeleton className="h-7 w-48" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-lg" />
    </div>
  );
}

function AuthGuard({ children }) {
  const session = useAuth();
  if (session === undefined) return null; // still loading
  if (!session) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/update-password" element={<UpdatePassword />} />
          <Route element={<AuthGuard><Layout /></AuthGuard>}>
            <Route index element={<Suspense fallback={<PageFallback />}><Dashboard /></Suspense>} />
            <Route path="forecast" element={<Suspense fallback={<PageFallback />}><Forecast /></Suspense>} />
            <Route path="locations" element={<Suspense fallback={<PageFallback />}><Locations /></Suspense>} />
            <Route path="item" element={<Suspense fallback={<PageFallback />}><ItemForecast /></Suspense>} />
            <Route path="item/:sku" element={<Suspense fallback={<PageFallback />}><ItemForecast /></Suspense>} />
            <Route path="po-history" element={<Suspense fallback={<PageFallback />}><POHistory /></Suspense>} />
            <Route path="reorder" element={<Suspense fallback={<PageFallback />}><ReorderAlerts /></Suspense>} />
            <Route path="open-transfer-orders" element={<Suspense fallback={<PageFallback />}><OpenTransferOrders /></Suspense>} />
            <Route path="on-order" element={<Suspense fallback={<PageFallback />}><OnOrder /></Suspense>} />
            <Route path="distributor-stock" element={<Suspense fallback={<PageFallback />}><DistributorStock /></Suspense>} />
            <Route path="sales-pipeline" element={<Suspense fallback={<PageFallback />}><SalesPipeline /></Suspense>} />
            <Route path="distributor-scorecard" element={<Suspense fallback={<PageFallback />}><DistributorScorecard /></Suspense>} />
            <Route path="backlog" element={<Suspense fallback={<PageFallback />}><Backlog /></Suspense>} />
            <Route path="lead-times" element={<Suspense fallback={<PageFallback />}><LeadTimes /></Suspense>} />
            <Route path="margins" element={<Suspense fallback={<PageFallback />}><Margins /></Suspense>} />
            <Route path="trends" element={<Suspense fallback={<PageFallback />}><Trends /></Suspense>} />
            <Route path="serials" element={<Suspense fallback={<PageFallback />}><Serials /></Suspense>} />
            <Route path="so-history" element={<Suspense fallback={<PageFallback />}><SoHistory /></Suspense>} />
            <Route path="pepsi" element={<Suspense fallback={<PageFallback />}><Pepsi /></Suspense>} />
          </Route>
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
