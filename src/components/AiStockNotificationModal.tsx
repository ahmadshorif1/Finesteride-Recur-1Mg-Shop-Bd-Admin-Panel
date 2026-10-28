import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  BrainCircuit,
  CheckCircle2,
  Clock,
  Package,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useStoreData } from '../context/StoreDataContext';
import type { AdminModuleKey } from '../types/pharmacy';

interface AiStockAlert {
  productId: string;
  productName: string;
  severity: 'critical' | 'warning' | 'info';
  alertType: 'out_of_stock' | 'low_stock' | 'near_expiry';
  messageBn: string;
  messageEn: string;
  suggestedReorderQuantity: number;
  runoutDaysEstimate?: number;
}

interface AiStockAnalysisResult {
  summaryBn: string;
  summaryEn: string;
  overallRiskLevel: 'high' | 'medium' | 'low';
  urgentAlerts: AiStockAlert[];
  recommendationsBn: string[];
  recommendationsEn: string[];
  aiPowered?: boolean;
  analyzedAt: string;
}

interface AiStockNotificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (module: AdminModuleKey) => void;
}

export function AiStockNotificationModal({
  isOpen,
  onClose,
  onNavigate,
}: AiStockNotificationModalProps) {
  const { user } = useAuth();
  const { language } = useLanguage();
  const { products, productBatches } = useStoreData();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AiStockAnalysisResult | null>(null);

  const fetchAiStockAnalysis = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = user ? await user.getIdToken() : '';
      const response = await fetch('/api/ai/stock-analysis', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          products: products.map((p) => ({
            id: p.id,
            name: p.name,
            genericName: p.genericName,
            categoryName: p.categoryName,
            stockQuantity: p.stockQuantity,
            minStockThreshold: p.lowStockThreshold,
            availabilityStatus: p.availabilityStatus,
            reorderQuantity: p.lowStockThreshold * 3,
          })),
          batches: productBatches.map((b) => ({
            id: b.id,
            productName: b.productName,
            batchNumber: b.batchNumber,
            expiryDate: b.expiryDate,
            quantityRemaining: b.quantityRemaining,
            status: b.status,
          })),
          language,
        }),
      });

      if (!response.ok) {
        throw new Error(`Server returned status ${response.status}`);
      }

      const data = (await response.json()) as AiStockAnalysisResult;
      setAnalysis(data);
    } catch (err) {
      console.error('Failed to fetch AI stock analysis:', err);
      setError(
        language === 'bn'
          ? 'AI স্টক বিশ্লেষণ সম্পন্ন করতে ব্যর্থ হয়েছে। অনুগ্রহ করে পুনরায় চেষ্টা করুন।'
          : 'Failed to generate AI stock analysis. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && !analysis) {
      void fetchAiStockAnalysis();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const isBn = language === 'bn';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0F172A]/50 backdrop-blur-xs no-print"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white rounded-2xl border border-[#E6ECEF] shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-[#0F8F83] via-[#0A6E67] to-[#064A46] text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
              <Bot className="w-6 h-6 text-[#6EE7B7]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold tracking-tight">
                  {isBn ? 'AI স্টক নোটিফিকেশন ও অ্যালার্ট' : 'AI Stock Notification & Alert Assistant'}
                </h3>
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/20 text-white">
                  <Sparkles className="w-3 h-3 text-[#FDE047]" />
                  {analysis?.aiPowered ? 'Gemini 3.8 Flash' : 'AI Proactive Engine'}
                </span>
              </div>
              <p className="text-xs text-white/80">
                {isBn
                  ? 'পণ্যের স্টক শেষ হওয়ার আগেই স্বয়ংক্রিয় নোটিফিকেশন ও পূর্বাভাস'
                  : 'Proactive inventory predictions & stock depletion alerts'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void fetchAiStockAnalysis()}
              disabled={loading}
              title={isBn ? 'পুনরায় বিশ্লেষণ করুন' : 'Re-analyze inventory'}
              className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center space-y-3 text-center">
              <BrainCircuit className="w-10 h-10 text-[#0D7E74] animate-bounce" />
              <div className="text-sm font-semibold text-[#0F172A]">
                {isBn
                  ? 'AI আপনার ফার্মেসির সকল স্টক এবং ব্যাচের তথ্য বিশ্লেষণ করছে...'
                  : 'AI is analyzing all pharmacy stock catalog and batch expiry records...'}
              </div>
              <p className="text-xs text-[#64748B] max-w-sm">
                {isBn
                  ? 'স্টক ফুরিয়ে যাওয়ার আনুমানিক দিন এবং পুনঃক্রয় পরিমাণ গণনা করা হচ্ছে।'
                  : 'Calculating estimated runout days and smart reorder quantities.'}
              </p>
            </div>
          ) : error ? (
            <div className="p-4 rounded-xl bg-[#FEF2F2] border border-[#FCA5A5] text-xs text-[#991B1B] space-y-2">
              <div className="font-semibold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                <span>{error}</span>
              </div>
              <button
                type="button"
                onClick={() => void fetchAiStockAnalysis()}
                className="px-3 py-1.5 text-xs font-semibold bg-[#DC2626] text-white rounded-lg hover:bg-[#B91C1C]"
              >
                {isBn ? 'পুনরায় চেষ্টা করুন' : 'Try Again'}
              </button>
            </div>
          ) : analysis ? (
            <>
              {/* Summary Banner */}
              <div
                className={`p-4 rounded-2xl border flex items-start gap-3 ${
                  analysis.overallRiskLevel === 'high'
                    ? 'bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]'
                    : analysis.overallRiskLevel === 'medium'
                    ? 'bg-[#FFFBEB] border-[#FDE68A] text-[#92400E]'
                    : 'bg-[#F0FDF4] border-[#BBF7D0] text-[#166534]'
                }`}
              >
                <AlertTriangle
                  className={`w-5 h-5 shrink-0 mt-0.5 ${
                    analysis.overallRiskLevel === 'high'
                      ? 'text-[#DC2626]'
                      : analysis.overallRiskLevel === 'medium'
                      ? 'text-[#D97706]'
                      : 'text-[#16A34A]'
                  }`}
                />
                <div className="space-y-1">
                  <div className="text-xs font-bold uppercase tracking-wider">
                    {isBn ? 'AI স্টক ঝুঁকি বিশ্লেষণ' : 'AI Stock Risk Assessment'}:{' '}
                    <span className="underline">
                      {analysis.overallRiskLevel === 'high'
                        ? isBn
                          ? 'উচ্চ ঝুঁকি (জরুরী ব্যবস্থা প্রয়োজন)'
                          : 'High Risk (Immediate Reorder Required)'
                        : analysis.overallRiskLevel === 'medium'
                        ? isBn
                          ? 'মাঝারি ঝুঁকি (নজরদারি প্রয়োজন)'
                          : 'Medium Risk (Action Advised)'
                        : isBn
                        ? 'স্বাভাবিক ও নিরাপদ'
                        : 'Safe & Nominal'}
                    </span>
                  </div>
                  <p className="text-xs font-medium leading-relaxed">
                    {isBn ? analysis.summaryBn : analysis.summaryEn}
                  </p>
                </div>
              </div>

              {/* Urgent Stock Depletion Notifications */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-[#0F172A] uppercase tracking-wider flex items-center gap-2">
                    <Package className="w-4 h-4 text-[#0D7E74]" />
                    {isBn ? 'জরুরী স্টক নোটিফিকেশনসমূহ' : 'Urgent Reorder Notifications'} ({analysis.urgentAlerts.length})
                  </h4>
                  <span className="text-[11px] text-[#64748B]">
                    {isBn ? 'স্টক শেষ হওয়ার পূর্বাভাস সহ' : 'With estimated depletion days'}
                  </span>
                </div>

                {analysis.urgentAlerts.length === 0 ? (
                  <div className="p-6 text-center rounded-xl bg-[#F8FAFB] border border-[#E6ECEF] space-y-2">
                    <CheckCircle2 className="w-8 h-8 text-[#16A34A] mx-auto" />
                    <p className="text-xs text-[#0F172A] font-semibold">
                      {isBn
                        ? 'আপনার দোকানের কোনো পণ্যের স্টক এখনই শেষ হওয়ার ঝুঁকিতে নেই।'
                        : 'No products are currently in danger of running out of stock.'}
                    </p>
                    <p className="text-[11px] text-[#64748B]">
                      {isBn
                        ? 'সকল ওষুধ ও পণ্য নিরাপদ স্টক সীমার মধ্যে বিদ্যমান।'
                        : 'All medicines and stock items are well above threshold limits.'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {analysis.urgentAlerts.map((alert, idx) => (
                      <div
                        key={`${alert.productId}-${idx}`}
                        className={`p-3.5 rounded-xl border flex items-start justify-between gap-3 text-xs ${
                          alert.severity === 'critical'
                            ? 'bg-[#FEF2F2] border-[#FCA5A5]'
                            : 'bg-[#FFFBEB] border-[#FCD34D]'
                        }`}
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-[#0F172A] truncate">
                              {alert.productName}
                            </span>
                            <span
                              className={`px-2 py-0.5 text-[10px] font-bold rounded-md uppercase ${
                                alert.severity === 'critical'
                                  ? 'bg-[#DC2626] text-white'
                                  : 'bg-[#D97706] text-white'
                              }`}
                            >
                              {alert.alertType === 'out_of_stock'
                                ? isBn
                                  ? 'স্টক আউট'
                                  : 'Out of Stock'
                                : alert.alertType === 'low_stock'
                                ? isBn
                                  ? 'স্বল্প স্টক'
                                  : 'Low Stock'
                                : isBn
                                ? 'মেয়াদ কাছাকাছি'
                                : 'Near Expiry'}
                            </span>
                          </div>

                          <p className="text-xs text-[#334155] leading-relaxed">
                            {isBn ? alert.messageBn : alert.messageEn}
                          </p>

                          {alert.suggestedReorderQuantity > 0 && (
                            <div className="text-[11px] font-medium text-[#0D7E74] flex items-center gap-2 pt-0.5">
                              <span>
                                {isBn
                                  ? `💡 AI প্রস্তাবিত পুনঃক্রয় পরিমাণ: ${alert.suggestedReorderQuantity} টি`
                                  : `💡 AI Suggested Reorder: ${alert.suggestedReorderQuantity} units`}
                              </span>
                            </div>
                          )}
                        </div>

                        {typeof alert.runoutDaysEstimate === 'number' && (
                          <div className="text-right shrink-0">
                            <div className="px-2.5 py-1 rounded-lg bg-white border border-[#E6ECEF] font-mono font-bold text-[#0F172A] text-xs flex items-center gap-1">
                              <Clock className="w-3 h-3 text-[#D97706]" />
                              <span>
                                {alert.runoutDaysEstimate === 0
                                  ? isBn
                                    ? 'আজই ফুরিয়েছে'
                                    : 'Depleted'
                                  : `${alert.runoutDaysEstimate} ${isBn ? 'দিন বাকি' : 'd left'}`}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* AI Strategic Advice & Reorder Recommendations */}
              <div className="p-4 rounded-2xl bg-[#F0FDFA] border border-[#CCFBF1] space-y-2.5">
                <h4 className="text-xs font-bold text-[#0D7E74] uppercase tracking-wider flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#0D7E74]" />
                  {isBn ? 'AI স্মার্ট ক্রয় ও ইনভেন্টরি পরামর্শ' : 'AI Purchasing & Stock Optimization Advice'}
                </h4>
                <ul className="space-y-1.5 text-xs text-[#0F172A]">
                  {(isBn ? analysis.recommendationsBn : analysis.recommendationsEn).map(
                    (rec, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-[#0D7E74] font-bold">•</span>
                        <span>{rec}</span>
                      </li>
                    )
                  )}
                </ul>
              </div>
            </>
          ) : null}
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-[#F8FAFB] border-t border-[#E6ECEF] flex items-center justify-between gap-3 shrink-0">
          <div className="text-[11px] text-[#64748B]">
            {analysis?.analyzedAt
              ? isBn
                ? `সর্বশেষ বিশ্লেষণ: ${new Date(analysis.analyzedAt).toLocaleTimeString('bn-BD')}`
                : `Last analyzed at ${new Date(analysis.analyzedAt).toLocaleTimeString()}`
              : ''}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-[#475569] hover:bg-[#E6ECEF] rounded-xl transition-colors"
            >
              {isBn ? 'বন্ধ করুন' : 'Close'}
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                onNavigate('inventory');
              }}
              className="px-4 py-2 text-xs font-bold text-white bg-gradient-to-r from-[#0E877C] to-[#064E49] hover:opacity-95 rounded-xl transition-opacity flex items-center gap-2 shadow-xs"
            >
              <Package className="w-4 h-4" />
              <span>{isBn ? 'ইনভেন্টরি ম্যানেজমেন্ট ওপেন করুন' : 'Open Inventory Management'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
