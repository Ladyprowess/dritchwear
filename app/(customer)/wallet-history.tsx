import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { ArrowLeft, Wallet, TrendingUp, TrendingDown, Calendar, Globe } from 'lucide-react-native';
import { formatCurrency, convertFromNGN } from '@/lib/currency';

interface Transaction {
  id: string;
  type: 'credit' | 'debit';
  amount: number;
  currency: string;
  original_amount: number | null;
  description: string;
  status: string;
  created_at: string;
  payment_provider: string;
}

export default function WalletHistoryScreen() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [displayCurrency, setDisplayCurrency] = useState(profile?.preferred_currency || 'NGN');

  const fetchTransactions = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTransactions(data || []);
    } catch (error) {
      console.error('Error fetching transactions:', error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchTransactions();
    setRefreshing(false);
  };

  useEffect(() => {
    fetchTransactions();
    if (profile) {
      setDisplayCurrency(profile.preferred_currency || 'NGN');
    }
  }, [user, profile]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

    if (diffInHours < 24) {
      return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      });
    } else if (diffInHours < 168) {
      return date.toLocaleDateString('en-US', {
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    } else {
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    }
  };

  const getTransactionIcon = (type: string) => {
    return type === 'credit' ? TrendingUp : TrendingDown;
  };

  const getTransactionColor = (type: string) => {
    return type === 'credit' ? '#10B981' : '#EF4444';
  };

  const getPaymentProviderIcon = (provider: string) => {
    switch (provider) {
      case 'paystack':
        return '🇳🇬';
      case 'paypal':
        return '🌍';
      case 'wallet':
        return '👛';
      default:
        return '💳';
    }
  };

  const getPaymentProviderName = (provider: string) => {
    switch (provider) {
      case 'paystack':
        return 'Paystack';
      case 'paypal':
        return 'PayPal';
      case 'wallet':
        return 'Wallet';
      default:
        return provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : 'Unknown';
    }
  };

  // Convert transaction amount to display currency
  const getDisplayAmount = (transaction: Transaction) => {
    // If transaction is already in the display currency, use it directly
    if (transaction.currency === displayCurrency) {
      return transaction.original_amount || transaction.amount;
    }
    
    // If transaction has original amount in a non-NGN currency
    if (transaction.original_amount && transaction.currency !== 'NGN' && transaction.currency === displayCurrency) {
      return transaction.original_amount;
    }
    
    // Otherwise convert from NGN to display currency
    return convertFromNGN(transaction.amount, displayCurrency);
  };

  const renderTransaction = (transaction: Transaction) => {
    const IconComponent = getTransactionIcon(transaction.type);
    const color = getTransactionColor(transaction.type);
    const providerIcon = getPaymentProviderIcon(transaction.payment_provider || 'wallet');
    const displayAmount = getDisplayAmount(transaction);
    const providerName = getPaymentProviderName(transaction.payment_provider || 'wallet');

    return (
      <View key={transaction.id} style={styles.transactionCard}>
        <View style={styles.transactionHeader}>
          <View style={[styles.transactionIcon, { backgroundColor: `${color}20` }]}>
            <IconComponent size={20} color={color} />
          </View>
          <View style={styles.transactionInfo}>
            <Text style={styles.transactionDescription}>
              {transaction.description}
            </Text>
            <View style={styles.transactionMeta}>
              <Text style={styles.transactionDate}>
                {formatDate(transaction.created_at)}
              </Text>
              {transaction.payment_provider && (
                <View style={styles.paymentProvider}>
                  <Text style={styles.providerIcon}>{providerIcon}</Text>
                  <Text style={styles.providerText}>
                    {providerName}
                  </Text>
                </View>
              )}
            </View>
          </View>
          <View style={styles.transactionAmount}>
            <Text style={[styles.amountText, { color }]}>
              {transaction.type === 'credit' ? '+' : '-'}{formatCurrency(displayAmount, displayCurrency)}
            </Text>
            {transaction.currency !== displayCurrency && (
              <Text style={styles.originalAmount}>
                {formatCurrency(transaction.amount, transaction.currency || 'NGN')}
              </Text>
            )}
            <Text style={styles.statusText}>
              {transaction.status.charAt(0).toUpperCase() + transaction.status.slice(1)}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  // Calculate totals in display currency
  const totalCredits = transactions
    .filter(t => t.type === 'credit' && t.status === 'completed')
    .reduce((sum, t) => sum + getDisplayAmount(t), 0);

  const totalDebits = transactions
    .filter(t => t.type === 'debit' && t.status === 'completed')
    .reduce((sum, t) => sum + getDisplayAmount(t), 0);

  // Get wallet balance in display currency
  const walletBalanceInDisplayCurrency = profile ? 
    (displayCurrency === 'NGN' ? 
      profile.wallet_balance : 
      convertFromNGN(profile.wallet_balance, displayCurrency)
    ) : 0;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <ArrowLeft size={24} color="#1F2937" />
        </Pressable>
        <Text style={styles.headerTitle}>Wallet History</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Current Balance */}
        <View style={styles.balanceCard}>
          <View style={styles.balanceHeader}>
            <Wallet size={24} color="#7C3AED" />
            <Text style={styles.balanceLabel}>Current Balance</Text>
          </View>
          <Text style={styles.balanceAmount}>
            {formatCurrency(walletBalanceInDisplayCurrency, displayCurrency)}
          </Text>
          <Text style={styles.balanceNote}>
            {displayCurrency !== 'NGN' ? 
              `Equivalent to ${formatCurrency(profile?.wallet_balance || 0, 'NGN')} in Nigerian Naira` :
              'Your wallet balance is maintained in Nigerian Naira (NGN)'
            }
          </Text>
        </View>

        {/* Summary Cards */}
        <View style={styles.summaryContainer}>
          <View style={styles.summaryCard}>
            <TrendingUp size={20} color="#10B981" />
            <Text style={styles.summaryLabel}>Total Credits</Text>
            <Text style={[styles.summaryAmount, { color: '#10B981' }]}>
              {formatCurrency(totalCredits, displayCurrency)}
            </Text>
          </View>
          <View style={styles.summaryCard}>
            <TrendingDown size={20} color="#EF4444" />
            <Text style={styles.summaryLabel}>Total Debits</Text>
            <Text style={[styles.summaryAmount, { color: '#EF4444' }]}>
              {formatCurrency(totalDebits, displayCurrency)}
            </Text>
          </View>
        </View>

        {/* Transactions */}
        <View style={styles.transactionsContainer}>
          <View style={styles.sectionHeader}>
            <Calendar size={20} color="#6B7280" />
            <Text style={styles.sectionTitle}>Transaction History</Text>
          </View>

          {loading ? (
            <View style={styles.loadingContainer}>
              <Text style={styles.loadingText}>Loading transactions...</Text>
            </View>
          ) : transactions.length > 0 ? (
            <View style={styles.transactionsList}>
              {transactions.map(renderTransaction)}
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <Wallet size={64} color="#D1D5DB" />
              <Text style={styles.emptyTitle}>No Transactions Yet</Text>
              <Text style={styles.emptySubtitle}>
                Your wallet transactions will appear here once you start funding or spending
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: 'Inter-Bold',
    color: '#1F2937',
  },
  placeholder: {
    width: 40,
  },
  scrollView: {
    flex: 1,
  },
  balanceCard: {
    backgroundColor: '#FFFFFF',
    margin: 20,
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  balanceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  balanceLabel: {
    fontSize: 16,
    fontFamily: 'Inter-Medium',
    color: '#6B7280',
  },
  balanceAmount: {
    fontSize: 32,
    fontFamily: 'Inter-Bold',
    color: '#1F2937',
    marginBottom: 8,
  },
  balanceNote: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
    color: '#9CA3AF',
  },
  summaryContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginBottom: 20,
    gap: 12,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  summaryLabel: {
    fontSize: 12,
    fontFamily: 'Inter-Medium',
    color: '#6B7280',
    marginTop: 8,
    marginBottom: 4,
  },
  summaryAmount: {
    fontSize: 16,
    fontFamily: 'Inter-Bold',
  },
  transactionsContainer: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontFamily: 'Inter-Bold',
    color: '#1F2937',
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 16,
    fontFamily: 'Inter-Regular',
    color: '#6B7280',
  },
  transactionsList: {
    gap: 12,
  },
  transactionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  transactionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  transactionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  transactionInfo: {
    flex: 1,
  },
  transactionDescription: {
    fontSize: 16,
    fontFamily: 'Inter-SemiBold',
    color: '#1F2937',
    marginBottom: 2,
  },
  transactionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  transactionDate: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    color: '#6B7280',
  },
  paymentProvider: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    gap: 4,
  },
  providerIcon: {
    fontSize: 12,
  },
  providerText: {
    fontSize: 12,
    fontFamily: 'Inter-Medium',
    color: '#6B7280',
  },
  transactionAmount: {
    alignItems: 'flex-end',
  },
  amountText: {
    fontSize: 16,
    fontFamily: 'Inter-Bold',
    marginBottom: 2,
  },
  originalAmount: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
    color: '#6B7280',
    marginBottom: 2,
  },
  statusText: {
    fontSize: 12,
    fontFamily: 'Inter-Medium',
    color: '#9CA3AF',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 20,
    fontFamily: 'Inter-Bold',
    color: '#1F2937',
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 16,
    fontFamily: 'Inter-Regular',
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 24,
  },
});