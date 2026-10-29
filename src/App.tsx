/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  Bell,
  Bot,
  Box,
  ChevronDown,
  FileCheck2,
  FolderTree,
  Globe,
  LayoutGrid,
  LogOut,
  Menu,
  MessageSquareText,
  Pill,
  Search,
  ShoppingBag,
  Sparkles,
  UserCog,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { AiStockNotificationModal } from './components/AiStockNotificationModal';
import { AuthGate } from './components/AuthGate';
import { PharmacyEmblem } from './components/BrandLogo';
import { CategoriesView } from './components/CategoriesView';
import { CustomersView } from './components/CustomersView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { InventoryView } from './components/InventoryView';
import { OrdersView } from './components/OrdersView';
import { OverviewView } from './components/OverviewView';
import { PaymentsDeliveryView } from './components/PaymentsDeliveryView';
import { PrescriptionsView } from './components/PrescriptionsView';
import { ProductsView } from './components/ProductsView';
import { PromotionsCmsView } from './components/PromotionsCmsView';
import { ReportsQaView } from './components/ReportsQaView';
import { StaffSecurityView } from './components/StaffSecurityView';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { StoreDataProvider, useStoreData } from './context/StoreDataContext';
import {
  subscribeForegroundFcmMessages,
  type ForegroundPushAlert,
} from './lib/pushNotifications';
import { formatBdt } from './lib/validation';
import { ROLE_PERMISSIONS, type AdminModuleKey } from './types/pharmacy';

interface NavItemConfig {
  key: AdminModuleKey;
  label: string;
  headerTitle: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItemConfig[] = [
  { key: 'overview', label: 'Dashboard', headerTitle: 'Dashboard', icon: LayoutGrid },
  {
    key: 'inventory',
    label: 'Inventory Management',
    headerTitle: 'Inventory & Batch Control',
    icon: Box,
  },
  {
    key: 'products',
    label: 'Medicine Catalog',
    headerTitle: 'Medicine Catalog',
    icon: Pill,
  },
  {
    key: 'categories',
    label: 'Categories & Brands',
    headerTitle: 'Categories, Brands & Navigation',
    icon: FolderTree,
  },
  {
    key: 'orders',
    label: 'Orders & Dispatch',
    headerTitle: 'Orders & Dispatch',
    icon: ShoppingBag,
  },
  {
    key: 'prescriptions',
    label: 'Prescriptions',
    headerTitle: 'Prescriptions',
    icon: FileCheck2,
  },
  {
    key: 'customers',
    label: 'Customers & Support',
    headerTitle: 'Customers & Support',
    icon: Users,
  },
  {
    key: 'payments_delivery',
    label: 'Payments & Delivery',
    headerTitle: 'Payments & Delivery Zones',
    icon: Wallet,
  },
  {
    key: 'promotions_cms',
    label: 'Promotions & CMS',
    headerTitle: 'Promotions & Storefront CMS',
    icon: Globe,
  },
  {
    key: 'reports_qa',
    label: 'Reports & Analytics',
    headerTitle: 'Reports & Analytics',
    icon: BarChart3,
  },
  {
    key: 'staff_security',
    label: 'Staff Management',
    headerTitle: 'Staff Management & Security',
    icon: UserCog,
  },
];

function AdminWorkspaceShell() {
  const { user, effectiveRole, staffProfile, logoutAdmin } = useAuth();
  const { language, toggleLanguage, t } = useLanguage();
  const {
    products,
    productBatches,
    orders,
    prescriptionReviews,
    customers,
    supportTickets,
  } = useStoreData();

  const [activeModule, setActiveModule] = useState<AdminModuleKey>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);

  // Global Quick Search State
  const [globalQuery, setGlobalQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [livePushAlert, setLivePushAlert] = useState<ForegroundPushAlert | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cleanup: (() => void) | null = null;
    let cancelled = false;
    void subscribeForegroundFcmMessages((alert) => {
      if (!cancelled) {
        setLivePushAlert(alert);
      }
    }).then((unsub) => {
      if (cancelled) {
        unsub?.();
      } else {
        cleanup = unsub;
      }
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileMenuOpen(false);
        setProfileMenuOpen(false);
        setSearchFocused(false);
      }
    };
    const onClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchFocused(false);
      }
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', onClickOutside);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousedown', onClickOutside);
    };
  }, []);

  const navCounts = useMemo(() => {
    const activeOrders = orders.filter(
      (o) => o.orderStatus === 'pending' || o.orderStatus === 'awaiting_review'
    ).length;
    const pendingRx = prescriptionReviews.filter(
      (r) => r.reviewStatus === 'pending_review'
    ).length;
    const openTickets = supportTickets.filter(
      (t) => t.status === 'open' || t.status === 'in_progress'
    ).length;
    const pendingPayments = orders.filter(
      (o) =>
        (o.paymentStatus === 'pending_verification' && o.orderStatus !== 'cancelled') ||
        o.paymentStatus === 'refund_pending'
    ).length;
    const stockAlerts =
      products.filter(
        (p) => p.availabilityStatus === 'low_stock' || p.availabilityStatus === 'out_of_stock'
      ).length +
      productBatches.filter(
        (b) => b.status === 'near_expiry' || b.status === 'expired_quarantined'
      ).length;

    return {
      orders: activeOrders,
      prescriptions: pendingRx,
      customers: openTickets,
      payments_delivery: pendingPayments,
      inventory: stockAlerts,
    } as Partial<Record<AdminModuleKey, number>>;
  }, [orders, prescriptionReviews, supportTickets, products, productBatches]);

  const globalSearchResults = useMemo(() => {
    const q = globalQuery.trim().toLowerCase();
    if (!q) return { medicines: [], orders: [], customers: [] };
    return {
      medicines: products
        .filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.genericName.toLowerCase().includes(q) ||
            p.sku.toLowerCase().includes(q)
        )
        .slice(0, 4),
      orders: orders
        .filter(
          (o) =>
            o.orderNumber.toLowerCase().includes(q) ||
            o.customerName.toLowerCase().includes(q) ||
            o.transactionReference.toLowerCase().includes(q)
        )
        .slice(0, 3),
      customers: customers
        .filter(
          (c) =>
            c.displayName.toLowerCase().includes(q) ||
            c.uid.toLowerCase().includes(q)
        )
        .slice(0, 3),
    };
  }, [globalQuery, products, orders, customers]);

  const totalSearchHits =
    globalSearchResults.medicines.length +
    globalSearchResults.orders.length +
    globalSearchResults.customers.length;

  const activeNavMeta =
    NAV_ITEMS.find((item) => item.key === activeModule) || NAV_ITEMS[0];

  const roleLabel = effectiveRole
    ? ROLE_PERMISSIONS[effectiveRole]?.label || 'Pharmacy Admin'
    : 'Pharmacy Admin';

  const fullDisplayIdentity =
    staffProfile?.displayName || user?.displayName || user?.email?.split('@')[0] || 'Admin';

  const initials = fullDisplayIdentity
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');

  const handleSelectModule = (mod: AdminModuleKey) => {
    setActiveModule(mod);
    setMobileMenuOpen(false);
    setSearchFocused(false);
  };

  const inventoryAlertCount = navCounts.inventory || 0;
  const rxAndSupportCount = (navCounts.prescriptions || 0) + (navCounts.customers || 0);

  const renderSidebarNavigation = () => (
    <div className="flex flex-col h-full bg-white">
      {/* Brand Lockup matching PharmaCore ERP header */}
      <div className="h-[72px] px-5 border-b border-[#E6ECEF] flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <PharmacyEmblem className="w-9 h-9 shrink-0" />
          <div className="min-w-0">
            <div className="text-[15px] font-bold text-[#0F172A] tracking-tight truncate">
              Finesteride Recur 1Mg
            </div>
            <div className="text-[11px] text-[#64748B] truncate">
              Smart Pharmacy Management
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setMobileMenuOpen(false)}
          className="lg:hidden p-1.5 text-[#64748B] hover:text-[#0F172A] rounded-lg"
          aria-label="Close navigation menu"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Main Menu Navigation */}
      <nav className="flex-1 overflow-y-auto px-3.5 py-4 space-y-1" aria-label="Main menu">
        <div className="px-3 pb-2 text-[11px] font-medium text-[#94A3B8]">
          Main Menu
        </div>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeModule === item.key;
          const count = navCounts[item.key] || 0;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => handleSelectModule(item.key)}
              className={`w-full flex items-center justify-between gap-2.5 px-3.5 py-2.5 text-[13px] font-medium rounded-xl transition-colors whitespace-nowrap ${
                isActive
                  ? 'bg-gradient-to-r from-[#0E877C] to-[#064E49] text-white shadow-xs'
                  : 'text-[#475569] hover:bg-[#F1F6F7] hover:text-[#0F172A]'
              }`}
            >
              <span className="flex items-center gap-3 min-w-0">
                <Icon
                  className={`w-[17px] h-[17px] shrink-0 ${
                    isActive ? 'text-white' : 'text-[#64748B]'
                  }`}
                />
                <span className="truncate">{item.label}</span>
              </span>
              {count > 0 && (
                <span
                  className={`text-xs font-mono tabular-nums shrink-0 ${
                    isActive ? 'text-white/90' : 'text-[#0D7E74] font-semibold'
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Bottom Deep-Teal Storefront Sync & QA Card */}
      <div className="p-3.5 shrink-0">
        <div className="rounded-2xl bg-gradient-to-br from-[#0F8D81] via-[#096760] to-[#054541] p-4 text-white relative overflow-hidden">
          <div className="space-y-1 relative z-10">
            <div className="text-sm font-semibold tracking-tight">
              Storefront QA &amp; Sync
            </div>
            <p className="text-[11px] text-white/80 leading-relaxed">
              Verify atomic checkout, Rx gates &amp; shared Firebase connection.
            </p>
            <div className="pt-2">
              <button
                type="button"
                onClick={() => handleSelectModule('reports_qa')}
                className="px-3.5 py-1.5 text-xs font-semibold text-[#07534E] bg-white hover:bg-[#F0FAF9] rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                Open QA Console
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F4F7F8] text-[#0F172A] flex">
      {/* Desktop Persistent Sidebar */}
      <aside className="hidden lg:flex lg:w-[256px] lg:flex-col lg:fixed lg:inset-y-0 border-r border-[#E6ECEF] bg-white z-20 no-print">
        {renderSidebarNavigation()}
      </aside>

      {/* Mobile Slide-Over Sidebar */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex no-print" role="dialog" aria-modal="true">
          <div
            className="fixed inset-0 bg-[#0F172A]/40"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="relative w-[268px] max-w-[85vw] h-full bg-white border-r border-[#E6ECEF] z-10">
            {renderSidebarNavigation()}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-[256px] flex flex-col min-w-0">
        {/* Top Bar matching uploaded PharmaCore ERP Header */}
        <header className="h-[72px] bg-white border-b border-[#E6ECEF] px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4 sticky top-0 z-20 no-print">
          {/* Left: Mobile Drawer Trigger + Active Module Heading */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 text-[#475569] hover:text-[#0F172A] rounded-lg"
              aria-label="Open navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="text-lg sm:text-xl font-bold text-[#0F172A] tracking-tight truncate">
              {activeNavMeta.headerTitle}
            </h1>
          </div>

          {/* Right: Live Global Search + Functional Alert Queues + Admin Profile */}
          <div className="flex items-center gap-3 sm:gap-4 shrink-0">
            {/* Live Global Search Input */}
            <div ref={searchRef} className="relative hidden md:block w-64 lg:w-80">
              <Search className="w-4 h-4 text-[#94A3B8] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={globalQuery}
                onFocus={() => setSearchFocused(true)}
                onChange={(e) => {
                  setGlobalQuery(e.target.value);
                  setSearchFocused(true);
                }}
                placeholder="Search medicines, patients, orders..."
                className="w-full pl-9 pr-3.5 py-2 text-xs bg-[#F4F7F8] border border-[#E6ECEF] rounded-xl text-[#0F172A] placeholder:text-[#94A3B8] focus:bg-white focus:border-[#0D7E74] focus:outline-none transition-colors"
              />

              {searchFocused && globalQuery.trim().length > 0 && (
                <div className="absolute right-0 left-0 mt-2 bg-white border border-[#E6ECEF] rounded-xl shadow-lg overflow-hidden z-30">
                  {totalSearchHits === 0 ? (
                    <div className="p-3.5 text-xs text-[#64748B]">
                      No matching medicines, orders, or customers for &ldquo;{globalQuery.trim()}&rdquo;.
                    </div>
                  ) : (
                    <div className="divide-y divide-[#EEF2F5] max-h-80 overflow-y-auto text-xs">
                      {globalSearchResults.medicines.length > 0 && (
                        <div className="p-2">
                          <div className="px-2 py-1 text-[11px] font-semibold text-[#64748B]">
                            Medicines
                          </div>
                          {globalSearchResults.medicines.map((med) => (
                            <button
                              key={med.id}
                              type="button"
                              onClick={() => {
                                handleSelectModule('products');
                                setGlobalQuery('');
                              }}
                              className="w-full px-2 py-1.5 text-left rounded-lg hover:bg-[#F4F7F8] flex items-center justify-between gap-2"
                            >
                              <span className="font-medium text-[#0F172A] truncate">
                                {med.name}
                              </span>
                              <span className="font-mono tabular-nums text-[#0D7E74] shrink-0">
                                {formatBdt(med.sellingPrice)}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}

                      {globalSearchResults.orders.length > 0 && (
                        <div className="p-2">
                          <div className="px-2 py-1 text-[11px] font-semibold text-[#64748B]">
                            Orders
                          </div>
                          {globalSearchResults.orders.map((ord) => (
                            <button
                              key={ord.id}
                              type="button"
                              onClick={() => {
                                handleSelectModule('orders');
                                setGlobalQuery('');
                              }}
                              className="w-full px-2 py-1.5 text-left rounded-lg hover:bg-[#F4F7F8] flex items-center justify-between gap-2"
                            >
                              <span className="font-mono font-medium text-[#0F172A]">
                                {ord.orderNumber} · {ord.customerName}
                              </span>
                              <span className="font-mono tabular-nums text-[#64748B] shrink-0">
                                {formatBdt(ord.totalAmountBdt)}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}

                      {globalSearchResults.customers.length > 0 && (
                        <div className="p-2">
                          <div className="px-2 py-1 text-[11px] font-semibold text-[#64748B]">
                            Customers
                          </div>
                          {globalSearchResults.customers.map((cust) => (
                            <button
                              key={cust.id}
                              type="button"
                              onClick={() => {
                                handleSelectModule('customers');
                                setGlobalQuery('');
                              }}
                              className="w-full px-2 py-1.5 text-left rounded-lg hover:bg-[#F4F7F8] flex items-center justify-between gap-2"
                            >
                              <span className="font-medium text-[#0F172A] truncate">
                                {cust.displayName}
                              </span>
                              <span className="font-mono tabular-nums text-[#64748B] shrink-0">
                                {cust.orderCount} order(s)
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* AI Stock Alert Notification Button */}
            <button
              type="button"
              onClick={() => setAiModalOpen(true)}
              title={t('AI স্টক অ্যালার্ট (AI নোটিফিকেশন)', 'AI Stock Alerts & Notifications')}
              aria-label="AI Stock Notifications"
              className="relative px-3 py-1.5 rounded-xl bg-gradient-to-r from-[#0E877C] to-[#064E49] hover:opacity-95 text-white text-xs font-bold flex items-center gap-1.5 transition-opacity shadow-xs shrink-0"
            >
              <Bot className="w-4 h-4 text-[#6EE7B7]" />
              <span className="hidden sm:inline">
                {t('AI নোটিফিকেশন', 'AI Alerts')}
              </span>
              <Sparkles className="w-3 h-3 text-[#FDE047]" />
              {inventoryAlertCount > 0 && (
                <span className="ml-1 min-w-[18px] h-[18px] px-1 rounded-md bg-[#EF4444] text-white text-[10px] font-mono tabular-nums font-bold flex items-center justify-center">
                  {inventoryAlertCount > 99 ? '99+' : inventoryAlertCount}
                </span>
              )}
            </button>

            {/* Functional Stock & Expiry Alert Quick-Jump */}
            <button
              type="button"
              onClick={() => handleSelectModule('inventory')}
              title="Open Inventory & Expiry Alerts"
              aria-label={`Inventory alerts (${inventoryAlertCount})`}
              className="relative w-9 h-9 rounded-full bg-[#F4F7F8] hover:bg-[#E7F1F0] border border-[#E6ECEF] flex items-center justify-center text-[#475569] hover:text-[#0D7E74] transition-colors shrink-0"
            >
              <Bell className="w-4 h-4" />
              {inventoryAlertCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-md bg-[#EF4444] text-white text-[10px] font-mono tabular-nums font-bold flex items-center justify-center">
                  {inventoryAlertCount > 99 ? '99+' : inventoryAlertCount}
                </span>
              )}
            </button>

            {/* Functional Clinical Rx & Support Queue Quick-Jump */}
            <button
              type="button"
              onClick={() => handleSelectModule('prescriptions')}
              title="Open Clinical Prescription Queue"
              aria-label={`Prescription and support queue (${rxAndSupportCount})`}
              className="relative w-9 h-9 rounded-full bg-[#F4F7F8] hover:bg-[#E7F1F0] border border-[#E6ECEF] flex items-center justify-center text-[#475569] hover:text-[#0D7E74] transition-colors shrink-0"
            >
              <MessageSquareText className="w-4 h-4" />
              {rxAndSupportCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-md bg-[#2563EB] text-white text-[10px] font-mono tabular-nums font-bold flex items-center justify-center">
                  {rxAndSupportCount > 99 ? '99+' : rxAndSupportCount}
                </span>
              )}
            </button>

            <div className="h-6 w-px bg-[#E6ECEF] hidden sm:block" />

            {/* Language Toggle Button (Bangla / English) */}
            {(() => {
              const { language, toggleLanguage } = useLanguage();
              return (
                <button
                  type="button"
                  onClick={toggleLanguage}
                  className="px-3 py-1.5 text-xs font-bold text-[#0D7E74] bg-[#F0FDFA] border border-[#CCFBF1] hover:bg-[#E0F7F5] rounded-xl transition-colors whitespace-nowrap shrink-0"
                  title="Switch Language (ভাষা পরিবর্তন করুন)"
                >
                  {language === 'bn' ? 'English 🌐' : 'বাংলা 🌐'}
                </button>
              );
            })()}

            {/* Admin Profile Dropdown */}
            <div ref={profileRef} className="relative">
              <button
                type="button"
                onClick={() => setProfileMenuOpen((prev) => !prev)}
                className="flex items-center gap-2.5 py-1 pl-1 pr-2 rounded-xl hover:bg-[#F4F7F8] transition-colors"
              >
                {user?.photoURL && !avatarFailed ? (
                  <img
                    src={user.photoURL}
                    alt={fullDisplayIdentity}
                    referrerPolicy="no-referrer"
                    onError={() => setAvatarFailed(true)}
                    className="w-9 h-9 rounded-full object-cover border border-[#E6ECEF] shrink-0"
                  />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#0E877C] to-[#064E49] text-white text-xs font-bold flex items-center justify-center shrink-0">
                    {initials || 'AD'}
                  </div>
                )}
                <div className="hidden sm:block text-left">
                  <div className="text-xs font-bold text-[#0F172A] leading-tight max-w-[130px] truncate">
                    {fullDisplayIdentity}
                  </div>
                  <div className="text-[11px] text-[#64748B] leading-tight truncate">
                    {roleLabel}
                  </div>
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-[#64748B] hidden sm:block shrink-0" />
              </button>

              {profileMenuOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-white border border-[#E6ECEF] rounded-xl shadow-lg py-1.5 z-30 text-xs">
                  <div className="px-3.5 py-2 border-b border-[#EEF2F5]">
                    <div className="font-semibold text-[#0F172A] truncate">
                      {fullDisplayIdentity}
                    </div>
                    <div className="text-[11px] text-[#64748B] truncate">{user?.email}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      handleSelectModule('staff_security');
                    }}
                    className="w-full px-3.5 py-2 text-left text-[#334155] hover:bg-[#F4F7F8] flex items-center gap-2 whitespace-nowrap"
                  >
                    <UserCog className="w-3.5 h-3.5 text-[#64748B]" />
                    Staff &amp; Security Settings
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      void logoutAdmin();
                    }}
                    className="w-full px-3.5 py-2 text-left text-[#DC2626] hover:bg-[#FEF2F2] flex items-center gap-2 whitespace-nowrap"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Active Module Viewport */}
        <main className="flex-1 p-4 sm:p-6 lg:p-7 max-w-[1440px] w-full mx-auto">
          {livePushAlert && (
            <div className="mb-4 bg-white border border-[#0D7E74]/30 rounded-xl p-4 flex items-start justify-between gap-3 shadow-xs no-print">
              <div className="flex items-start gap-3 min-w-0">
                <Bell className="w-4 h-4 text-[#0D7E74] shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[#0F172A]">
                    {livePushAlert.title}
                  </div>
                  <p className="text-xs text-[#64748B] mt-0.5">{livePushAlert.body}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLivePushAlert(null)}
                className="p-1 text-[#64748B] hover:text-[#0F172A] rounded-md shrink-0"
                aria-label="Dismiss push alert"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {activeModule === 'overview' && <OverviewView onNavigate={handleSelectModule} />}
          {activeModule === 'products' && <ProductsView />}
          {activeModule === 'categories' && <CategoriesView onNavigate={handleSelectModule} />}
          {activeModule === 'inventory' && <InventoryView />}
          {activeModule === 'orders' && <OrdersView />}
          {activeModule === 'prescriptions' && <PrescriptionsView />}
          {activeModule === 'customers' && <CustomersView />}
          {activeModule === 'payments_delivery' && <PaymentsDeliveryView />}
          {activeModule === 'promotions_cms' && <PromotionsCmsView />}
          {activeModule === 'staff_security' && <StaffSecurityView />}
          {activeModule === 'reports_qa' && <ReportsQaView />}
        </main>
      </div>

      <AiStockNotificationModal
        isOpen={aiModalOpen}
        onClose={() => setAiModalOpen(false)}
        onNavigate={handleSelectModule}
      />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <LanguageProvider>
        <AuthProvider>
          <AuthGate>
            <StoreDataProvider>
              <AdminWorkspaceShell />
            </StoreDataProvider>
          </AuthGate>
        </AuthProvider>
      </LanguageProvider>
    </ErrorBoundary>
  );
}
