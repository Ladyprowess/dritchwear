import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Modal, TextInput, Alert, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X, Package, Calendar, MapPin, CreditCard, User, Send, DollarSign, CheckCircle, XCircle, Globe, Tag, Building, Palette, Target, FileText } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import ProductReviews from './ProductReviews';
import { formatCurrency, convertFromNGN, convertToNGN } from '@/lib/currency';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';

interface OrderItem {
  product_id: string;
  name: string;
  price: number;
  quantity: number;
  size: string;
  color: string;
}

interface Order {
  id: string;
  user_id: string;
  items?: OrderItem[];
  subtotal?: number;
  service_fee?: number;
  delivery_fee?: number;
  total: number;
  payment_method?: string;
  payment_status?: string;
  order_status?: string;
  delivery_address?: string;
  created_at: string;
  currency?: string;
  original_amount?: number;
  promo_code?: string;
  discount_amount?: number;
  profiles?: {
    full_name: string;
    email: string;
    wallet_balance: number;
    preferred_currency?: string;
  };
  // Custom order fields
  title?: string;
  description?: string;
  quantity?: number;
  budget_range?: string;
  status?: string;
  invoice_sent?: boolean;
  invoices?: Invoice[];
  // Enhanced custom order fields
  business_name?: string;
  event_name?: string;
  logo_url?: string;
  brand_colors?: string[];
  logo_placement?: string;
  delivery_address?: string;
  deadline?: string;
  additional_notes?: string;
}

interface Invoice {
  id: string;
  amount: number;
  description: string;
  status: string;
  currency: string;
  original_amount: number;
  created_at: string;
}

interface OrderDetailsModalProps {
  order: Order | null;
  visible: boolean;
  onClose: () => void;
  onOrderUpdate: () => void;
}

const statusOptions = [
  'pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'
];

const customStatusOptions = [
  'pending', 'under_review', 'quoted', 'accepted', 'rejected', 'payment_made', 'completed', 'cancelled'
];

export default function OrderDetailsModal({ order, visible, onClose, onOrderUpdate }: OrderDetailsModalProps) {
  const { isAdmin, profile, user } = useAuth();
  const [updating, setUpdating] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [reviewRefreshKey, setReviewRefreshKey] = useState(0);

  const downloadImage = async (imageUrl: string) => {
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission denied', 'You need to allow access to save images.');
      return;
    }
  
    try {
      const fileName = imageUrl.split('/').pop();
      const fileUri = FileSystem.documentDirectory + fileName;
  
      const downloaded = await FileSystem.downloadAsync(imageUrl, fileUri);
      const asset = await MediaLibrary.createAssetAsync(downloaded.uri);
      await MediaLibrary.createAlbumAsync('Downloads', asset, false);
  
      Alert.alert('Download complete', 'The logo has been saved to your Downloads.');
    } catch (error) {
      console.error('Download failed:', error);
      Alert.alert('Download failed', 'Could not save the image.');
    }
  };
  
  const [invoiceData, setInvoiceData] = useState({
    amount: '',
    description: '',
  });

  if (!order) return null;

  const isCustomOrder = !order.items;
  const currentStatus = isCustomOrder ? order.status : order.order_status;
  
  // Check if customer can write reviews (non-admin users with delivered orders)
  const canWriteReviews = !isAdmin && !isCustomOrder && order.order_status === 'delivered';

  // FIXED: Determine the actual payment currency used
  const getActualPaymentCurrency = () => {
    // For custom orders, use the stored currency or customer preference
    if (isCustomOrder) {
      return order.currency || order.profiles?.preferred_currency || 'NGN';
    }
    
    // For regular orders, use the actual payment currency stored in the order
    return order.currency || 'NGN';
  };

  const actualPaymentCurrency = getActualPaymentCurrency();

  // FIXED: Format amounts using the actual payment currency
  const formatAmountInPaymentCurrency = (amount: number) => {
    // If the order has original_amount and currency, use those (actual payment details)
    if (order.original_amount && order.currency && !isCustomOrder) {
      // For the main total, use the original amount in payment currency
      if (amount === order.total) {
        return formatCurrency(order.original_amount, order.currency);
      }
      // For other amounts, convert proportionally
      const ratio = order.original_amount / order.total;
      const convertedAmount = amount * ratio;
      return formatCurrency(convertedAmount, order.currency);
    }
    
    // If payment was in NGN or no conversion data available
    if (actualPaymentCurrency === 'NGN') {
      return formatCurrency(amount, 'NGN');
    }
    
    // Convert from NGN to payment currency
    const convertedAmount = convertFromNGN(amount, actualPaymentCurrency);
    return formatCurrency(convertedAmount, actualPaymentCurrency);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleStatusUpdate = async (newStatus: string) => {
    if (!order) return;

    setUpdating(true);
    try {
      const table = isCustomOrder ? 'custom_requests' : 'orders';
      const statusField = isCustomOrder ? 'status' : 'order_status';

      // Handle cancellation with refund
      if (newStatus === 'cancelled' && !isCustomOrder && order.payment_status === 'paid') {
        await handleRefund();
      }

      const { error } = await supabase
        .from(table)
        .update({ [statusField]: newStatus })
        .eq('id', order.id);

      if (error) throw error;

      // Send notification to customer about status change
      await supabase
        .from('notifications')
        .insert({
          user_id: order.user_id,
          title: `Order ${newStatus.charAt(0).toUpperCase() + newStatus.slice(1)}`,
          message: isCustomOrder 
            ? `Your custom order "${order.title}" has been ${newStatus}`
            : `Your order #${order.id.toString().substring(0, 8)} has been ${newStatus}`,
          type: 'order',
          is_read: false
        });

      Alert.alert('Success', 'Order status updated successfully');
      onOrderUpdate();
      onClose();
    } catch (error) {
      console.error('Error updating status:', error);
      Alert.alert('Error', 'Failed to update order status');
    } finally {
      setUpdating(false);
    }
  };

  const handleRefund = async () => {
    if (!order?.profiles) return;

    try {
      // Update user's wallet balance
      const { error: walletError } = await supabase
        .from('profiles')
        .update({
          wallet_balance: order.profiles.wallet_balance + order.total
        })
        .eq('id', order.user_id);

      if (walletError) throw walletError;

      // Create refund transaction record
      const { error: transactionError } = await supabase
        .from('transactions')
        .insert({
          user_id: order.user_id,
          type: 'credit',
          amount: order.total,
          description: `Refund for cancelled order #${order.id.toString().substring(0, 8)}`,
          reference: order.id,
          status: 'completed'
        });

      if (transactionError) throw transactionError;

      // Update payment status to refunded
      const { error: paymentError } = await supabase
        .from('orders')
        .update({ payment_status: 'refunded' })
        .eq('id', order.id);

      if (paymentError) throw paymentError;

    } catch (error) {
      console.error('Error processing refund:', error);
      throw error;
    }
  };

  const handleSendInvoice = async () => {
    if (!invoiceData.amount || !invoiceData.description) {
      Alert.alert('Error', 'Please fill in all invoice fields');
      return;
    }

    // Check if invoice has already been sent
    if (order.invoice_sent) {
      Alert.alert(
        'Invoice Already Sent', 
        'An invoice has already been sent for this custom order. Only one invoice can be sent per order.',
        [{ text: 'OK' }]
      );
      return;
    }

    // Check if an invoice already exists (database constraint backup)
    if (order.invoices && order.invoices.length > 0) {
      Alert.alert(
        'Invoice Already Exists', 
        'An invoice already exists for this custom order.',
        [{ text: 'OK' }]
      );
      return;
    }

    try {
      const amountInCustomerCurrency = parseFloat(invoiceData.amount);
      // Convert to NGN for storage (our base currency)
      const amountInNGN = actualPaymentCurrency === 'NGN' ? 
        amountInCustomerCurrency : 
        convertToNGN(amountInCustomerCurrency, actualPaymentCurrency);

      // Use a transaction to ensure atomicity
      const { error: invoiceError } = await supabase
        .from('invoices')
        .insert({
          custom_request_id: order.id,
          user_id: order.user_id,
          amount: amountInNGN, // Store in NGN
          original_amount: amountInCustomerCurrency, // Store original amount
          currency: actualPaymentCurrency, // Store customer's currency
          description: invoiceData.description,
          status: 'sent'
        });

      if (invoiceError) {
        // Check if it's a unique constraint violation
        if (invoiceError.code === '23505' && invoiceError.message.includes('unique_invoice_per_custom_request')) {
          Alert.alert(
            'Invoice Already Exists',
            'An invoice has already been sent for this custom order. Only one invoice can be sent per order.',
            [{ text: 'OK' }]
          );
          return;
        }
        throw invoiceError;
      }

      // Update custom request to mark invoice as sent and update status
      const { error: statusError } = await supabase
        .from('custom_requests')
        .update({ 
          status: 'quoted',
          invoice_sent: true
        })
        .eq('id', order.id);

      if (statusError) throw statusError;

      // Send notification to customer
      await supabase
        .from('notifications')
        .insert({
          user_id: order.user_id,
          title: 'Invoice Received',
          message: `You've received an invoice for your custom order "${order.title}". Please review and respond.`,
          type: 'custom',
          is_read: false
        });

      Alert.alert('Success', `Invoice sent successfully in ${actualPaymentCurrency}`);
      setShowInvoiceModal(false);
      setInvoiceData({ amount: '', description: '' });
      onOrderUpdate();
    } catch (error) {
      console.error('Error sending invoice:', error);
      Alert.alert('Error', 'Failed to send invoice');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return '#F59E0B';
      case 'confirmed': return '#10B981';
      case 'processing': return '#3B82F6';
      case 'shipped': return '#8B5CF6';
      case 'delivered': return '#059669';
      case 'cancelled': return '#EF4444';
      case 'under_review': return '#3B82F6';
      case 'quoted': return '#F59E0B';
      case 'accepted': return '#10B981';
      case 'rejected': return '#EF4444';
      case 'payment_made': return '#8B5CF6';
      case 'completed': return '#059669';
      default: return '#6B7280';
    }
  };

  // Check if invoice can be sent
  const canSendInvoice = () => {
    if (!isAdmin || !isCustomOrder) return false;
    if (['completed', 'cancelled', 'rejected'].includes(currentStatus || '')) return false;
    // Check both invoice_sent flag and existing invoices
    if (order.invoice_sent || (order.invoices && order.invoices.length > 0)) return false;
    return true;
  };

  return (
    <>
      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={onClose}
      >
        <SafeAreaView style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>
              {isCustomOrder ? 'Custom Order Details' : 'Order Details'}
            </Text>
            <Pressable style={styles.closeButton} onPress={onClose}>
              <X size={24} color="#1F2937" />
            </Pressable>
          </View>

          <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
            {/* Order Info */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Order Information</Text>
              <View style={styles.infoCard}>
                <View style={styles.infoRow}>
                  <Package size={20} color="#6B7280" />
                  <View style={styles.infoContent}>
                    <Text style={styles.infoLabel}>Order ID</Text>
                    <Text style={styles.infoValue}>
                      #{order.id.toString().substring(0, 8)}
                    </Text>
                  </View>
                </View>

                <View style={styles.infoRow}>
                  <Calendar size={20} color="#6B7280" />
                  <View style={styles.infoContent}>
                    <Text style={styles.infoLabel}>Created</Text>
                    <Text style={styles.infoValue}>
                      {formatDate(order.created_at)}
                    </Text>
                  </View>
                </View>

                {isAdmin && (
                  <View style={styles.infoRow}>
                    <User size={20} color="#6B7280" />
                    <View style={styles.infoContent}>
                      <Text style={styles.infoLabel}>Customer</Text>
                      <Text style={styles.infoValue}>
                        {order.profiles?.full_name || order.profiles?.email || 'Unknown'}
                      </Text>
                    </View>
                  </View>
                )}

                <View style={styles.infoRow}>
                  <Globe size={20} color="#6B7280" />
                  <View style={styles.infoContent}>
                    <Text style={styles.infoLabel}>Payment Currency</Text>
                    <Text style={styles.infoValue}>{actualPaymentCurrency}</Text>
                  </View>
                </View>

                {/* Promo Code (if applied) */}
                {!isCustomOrder && order.promo_code && (
                  <View style={styles.infoRow}>
                    <Tag size={20} color="#10B981" />
                    <View style={styles.infoContent}>
                      <Text style={styles.infoLabel}>Promo Code</Text>
                      <Text style={[styles.infoValue, { color: '#10B981' }]}>
                        {order.promo_code} ({formatCurrency(order.discount_amount || 0, 'NGN')} discount)
                      </Text>
                    </View>
                  </View>
                )}

                {/* Show invoice status for custom orders */}
                {isCustomOrder && (
                  <View style={styles.infoRow}>
                    <Send size={20} color="#6B7280" />
                    <View style={styles.infoContent}>
                      <Text style={styles.infoLabel}>Invoice Status</Text>
                      <Text
                        style={[
                          styles.infoValue,
                          { color: (order.invoice_sent || (order.invoices && order.invoices.length > 0)) ? '#10B981' : '#F59E0B' }
                        ]}
                      >
                        {(order.invoice_sent || (order.invoices && order.invoices.length > 0))
                          ? isAdmin ? 'Invoice Sent' : 'Invoice Received'
                          : 'No Invoice Yet'}
                      </Text>
                    </View>
                  </View>
                )}

                {!isCustomOrder && order.delivery_address && (
                  <View style={styles.infoRow}>
                    <MapPin size={20} color="#6B7280" />
                    <View style={styles.infoContent}>
                      <Text style={styles.infoLabel}>Delivery Address</Text>
                      <Text style={styles.infoValue}>{order.delivery_address}</Text>
                    </View>
                  </View>
                )}
              </View>
            </View>

            {/* Current Status Display (for all users) */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Order Status</Text>
              <View style={styles.statusDisplayCard}>
                <View style={[styles.statusBadge, { backgroundColor: `${getStatusColor(currentStatus || '')}20` }]}>
                  <Text style={[styles.statusText, { color: getStatusColor(currentStatus || '') }]}>
                    {currentStatus?.charAt(0).toUpperCase() + currentStatus?.slice(1).replace('_', ' ')}
                  </Text>
                </View>
              </View>
            </View>

            {/* Status Management (Admin Only) */}
            {isAdmin && !['completed', 'cancelled', 'delivered', 'rejected'].includes(currentStatus || '') && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Status Management</Text>
                <View style={styles.statusCard}>
                  <Text style={styles.updateStatusLabel}>Update Status</Text>
                  <View style={styles.statusOptions}>
                    {(isCustomOrder ? customStatusOptions : statusOptions).map((status) => (
                      <Pressable
                        key={status}
                        style={[
                          styles.statusOption,
                          currentStatus === status && styles.statusOptionActive
                        ]}
                        onPress={() => handleStatusUpdate(status)}
                        disabled={updating || currentStatus === status}
                      >
                        <Text
                          style={[
                            styles.statusOptionText,
                            currentStatus === status && styles.statusOptionTextActive
                          ]}
                        >
                          {status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ')}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              </View>
            )}

            {/* Order Details */}
            {isCustomOrder ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Custom Order Details</Text>
                <View style={styles.customOrderCard}>
                  <Text style={styles.customOrderTitle}>{order.title}</Text>
                  <Text style={styles.customOrderDescription}>{order.description}</Text>
                  <View style={styles.customOrderMeta}>
                    <Text style={styles.customOrderMetaItem}>Quantity: {order.quantity}</Text>
                    <Text style={styles.customOrderMetaItem}>Budget: {order.budget_range}</Text>
                  </View>
                  
                  {/* Enhanced Custom Order Information */}
                  {(order.business_name || order.event_name || order.logo_url || order.brand_colors || order.logo_placement || order.delivery_address || order.deadline || order.additional_notes) && (
                    <View style={styles.enhancedDetailsSection}>
                      <Text style={styles.enhancedDetailsTitle}>Additional Details</Text>
                      
                      {order.business_name && (
                        <View style={styles.detailRow}>
                          <Building size={16} color="#6B7280" />
                          <View style={styles.detailContent}>
                            <Text style={styles.detailLabel}>Business Name</Text>
                            <Text style={styles.detailValue}>{order.business_name}</Text>
                          </View>
                        </View>
                      )}
                      
                      {order.logo_url && (
                        <View style={styles.detailRow}>
                          <FileText size={16} color="#6B7280" />
                          <View style={styles.detailContent}>
                            <Text style={styles.detailLabel}>Logo</Text>
                            <Image 
                              source={{ uri: order.logo_url }}
                              style={{ width: 80, height: 80, borderRadius: 8, marginTop: 6, backgroundColor: '#F3F4F6' }}
                              resizeMode="contain"
                            />
                            <Pressable onPress={() => downloadImage(order.logo_url)} style={{ marginTop: 6 }}>
                              <Text style={{ color: '#7C3AED', fontSize: 13, fontWeight: '600' }}>
                                Download Logo
                              </Text>
                            </Pressable>
                          </View>
                        </View>
                      )}
                      
                      {order.brand_colors && order.brand_colors.length > 0 && (
                        <View style={styles.detailRow}>
                          <Palette size={16} color="#6B7280" />
                          <View style={styles.detailContent}>
                            <Text style={styles.detailLabel}>Brand Colors</Text>
                            <Text style={styles.detailValue}>{order.brand_colors.join(', ')}</Text>
                          </View>
                        </View>
                      )}
                      
                      {order.logo_placement && (
                        <View style={styles.detailRow}>
                          <Target size={16} color="#6B7280" />
                          <View style={styles.detailContent}>
                            <Text style={styles.detailLabel}>Logo Placement</Text>
                            <Text style={styles.detailValue}>{order.logo_placement}</Text>
                          </View>
                        </View>
                      )}
                      
                      {order.delivery_address && (
                        <View style={styles.detailRow}>
                          <MapPin size={16} color="#6B7280" />
                          <View style={styles.detailContent}>
                            <Text style={styles.detailLabel}>Delivery Address</Text>
                            <Text style={styles.detailValue}>{order.delivery_address}</Text>
                          </View>
                        </View>
                      )}
                      
                      {order.deadline && (
                        <View style={styles.detailRow}>
                          <Calendar size={16} color="#6B7280" />
                          <View style={styles.detailContent}>
                            <Text style={styles.detailLabel}>Deadline</Text>
                            <Text style={styles.detailValue}>
                              {new Date(order.deadline).toLocaleDateString('en-US', {
                                month: 'long',
                                day: 'numeric',
                                year: 'numeric',
                              })}
                            </Text>
                          </View>
                        </View>
                      )}
                      
                      {order.additional_notes && (
                        <View style={styles.detailRow}>
                          <FileText size={16} color="#6B7280" />
                          <View style={styles.detailContent}>
                            <Text style={styles.detailLabel}>Additional Notes</Text>
                            <Text style={styles.detailValue}>{order.additional_notes}</Text>
                          </View>
                        </View>
                      )}
                    </View>
                  )}
                </View>

                {/* Invoices */}
                {order.invoices && order.invoices.length > 0 && (
                  <View style={styles.invoicesSection}>
                    <Text style={styles.invoicesTitle}>Invoices</Text>
                    {order.invoices.map((invoice) => (
                      <View key={invoice.id} style={styles.invoiceCard}>
                        <View style={styles.invoiceHeader}>
                          <Text style={styles.invoiceAmount}>
                            {formatCurrency(invoice.original_amount || invoice.amount, invoice.currency || actualPaymentCurrency)}
                          </Text>
                          <Text style={[
                            styles.invoiceStatus,
                            { color: getStatusColor(invoice.status) }
                          ]}>
                            {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
                          </Text>
                        </View>
                        <Text style={styles.invoiceDescription}>{invoice.description}</Text>
                        <Text style={styles.invoiceDate}>{formatDate(invoice.created_at)}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* Send Invoice Button - Only show if invoice can be sent */}
                {canSendInvoice() && (
                  <Pressable
                    style={styles.sendInvoiceButton}
                    onPress={() => setShowInvoiceModal(true)}
                  >
                    <Send size={20} color="#FFFFFF" />
                    <Text style={styles.sendInvoiceText}>Send Invoice ({actualPaymentCurrency})</Text>
                  </Pressable>
                )}

                {/* Show message if invoice already sent */}
                {isAdmin && isCustomOrder && (order.invoice_sent || (order.invoices && order.invoices.length > 0)) && (
                  <View style={styles.invoiceAlreadySentCard}>
                    <CheckCircle size={20} color="#10B981" />
                    <Text style={styles.invoiceAlreadySentText}>
                      Invoice has already been sent for this order
                    </Text>
                  </View>
                )}
              </View>
            ) : (
              <>
                {/* Regular Order Items */}
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Order Items</Text>
                  {order.items?.map((item, index) => (
                    <View key={index} style={styles.itemCard}>
                      <View style={styles.itemInfo}>
                        <Text style={styles.itemName}>{item.name}</Text>
                        <Text style={styles.itemVariants}>
                          Size: {item.size} • Color: {item.color}
                        </Text>
                        <Text style={styles.itemQuantity}>Qty: {item.quantity}</Text>
                      </View>
                      <Text style={styles.itemPrice}>
                        {formatAmountInPaymentCurrency(item.price * item.quantity)}
                      </Text>
                    </View>
                  ))}
                </View>

                {/* Order Summary */}
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Order Summary</Text>
                  <View style={styles.summaryCard}>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Subtotal</Text>
                      <Text style={styles.summaryValue}>{formatAmountInPaymentCurrency(order.subtotal || 0)}</Text>
                    </View>
                    
                    {/* Show discount if promo code was applied */}
                    {order.promo_code && order.discount_amount && order.discount_amount > 0 && (
                      <View style={styles.summaryRow}>
                        <Text style={styles.summaryLabel}>Discount ({order.promo_code})</Text>
                        <Text style={styles.discountValue}>
                          -{formatAmountInPaymentCurrency(order.discount_amount)}
                        </Text>
                      </View>
                    )}
                    
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Service Fee</Text>
                      <Text style={styles.summaryValue}>{formatAmountInPaymentCurrency(order.service_fee || 0)}</Text>
                    </View>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Delivery Fee</Text>
                      <Text style={styles.summaryValue}>{formatAmountInPaymentCurrency(order.delivery_fee || 0)}</Text>
                    </View>
                    <View style={[styles.summaryRow, styles.summaryTotal]}>
                      <Text style={styles.summaryTotalLabel}>Total</Text>
                      <Text style={styles.summaryTotalValue}>{formatAmountInPaymentCurrency(order.total)}</Text>
                    </View>
                  </View>
                </View>

                {/* Payment Info */}
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Payment Information</Text>
                  <View style={styles.paymentCard}>
                    <View style={styles.paymentRow}>
                      <CreditCard size={20} color="#6B7280" />
                      <View style={styles.paymentInfo}>
                        <Text style={styles.paymentMethod}>
                          {order.payment_method === 'wallet' ? 'Wallet Payment' : 'Card Payment'}
                        </Text>
                        <Text style={[
                          styles.paymentStatus,
                          { color: order.payment_status === 'paid' ? '#10B981' : '#F59E0B' }
                        ]}>
                          {order.payment_status?.charAt(0).toUpperCase() + order.payment_status?.slice(1)}
                        </Text>
                        <Text style={styles.paymentCurrency}>
                          Paid in {actualPaymentCurrency}
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>

                {/* Product Reviews Section - For delivered regular orders */}
{(!isCustomOrder && order.order_status === 'delivered') && (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Product Reviews</Text>
<Text style={styles.reviewsSubtitle}>
  {isAdmin ? 'Manage product reviews for this order' : 'Share your experience with these products to help other customers'}
</Text>
                    {order.items?.map((item, index) => (
                      <View key={index} style={styles.reviewSection}>
                        <View style={styles.reviewProductHeader}>
                          <Text style={styles.reviewProductName}>{item.name}</Text>
                          <Text style={styles.reviewProductDetails}>
                            Size: {item.size} • Color: {item.color} • Qty: {item.quantity}
                          </Text>
                        </View>
                        <ProductReviews 
  key={`review-${item.product_id}-${reviewRefreshKey}`}
  productId={item.product_id} 
  onReviewsUpdate={() => setReviewRefreshKey(prev => prev + 1)}
  showAddReview={!isAdmin}
  currentUserId={user?.id}
  isAdminUser={isAdmin}
/>

                      </View>
                    ))}
                  </View>
                )}
              </>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Invoice Modal - Only for admins */}
      {isAdmin && isCustomOrder && (
        <Modal
          visible={showInvoiceModal}
          animationType="slide"
          transparent
          onRequestClose={() => setShowInvoiceModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.invoiceModalContent}>
              <Text style={styles.invoiceModalTitle}>Send Invoice ({actualPaymentCurrency})</Text>
              
              <View style={styles.invoiceForm}>
                <Text style={styles.invoiceFormLabel}>Amount ({actualPaymentCurrency})</Text>
                <TextInput
                  style={styles.invoiceFormInput}
                  value={invoiceData.amount}
                  onChangeText={(text) => setInvoiceData(prev => ({ ...prev, amount: text }))}
                  placeholder={`Enter amount in ${actualPaymentCurrency}`}
                  keyboardType="numeric"
                />

                <Text style={styles.invoiceFormLabel}>Description</Text>
                <TextInput
                  style={[styles.invoiceFormInput, styles.invoiceFormTextArea]}
                  value={invoiceData.description}
                  onChangeText={(text) => setInvoiceData(prev => ({ ...prev, description: text }))}
                  placeholder="Enter invoice description"
                  multiline
                  numberOfLines={3}
                />

                <Text style={styles.currencyNote}>
                  💡 Invoice will be sent in payment currency: {actualPaymentCurrency}
                </Text>

                {/* Warning about single invoice policy */}
                <View style={styles.warningCard}>
                  <Text style={styles.warningText}>
                    ⚠️ Only one invoice can be sent per custom order. Please ensure all details are correct before sending.
                  </Text>
                </View>
              </View>

              <View style={styles.invoiceModalActions}>
                <Pressable
                  style={styles.invoiceModalCancel}
                  onPress={() => setShowInvoiceModal(false)}
                >
                  <Text style={styles.invoiceModalCancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={styles.invoiceModalSend}
                  onPress={handleSendInvoice}
                >
                  <Text style={styles.invoiceModalSendText}>Send Invoice</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: 'Inter-Bold',
    color: '#1F2937',
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
  },
  section: {
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: 'Inter-SemiBold',
    color: '#1F2937',
    marginBottom: 12,
  },
  infoCard: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 16,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  infoContent: {
    marginLeft: 12,
    flex: 1,
  },
  infoLabel: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
    color: '#6B7280',
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 14,
    fontFamily: 'Inter-SemiBold',
    color: '#1F2937',
  },
  statusDisplayCard: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  statusCard: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 16,
  },
  statusBadge: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    alignSelf: 'center',
  },
  statusText: {
    fontSize: 14,
    fontFamily: 'Inter-SemiBold',
    textAlign: 'center',
  },
  updateStatusLabel: {
    fontSize: 14,
    fontFamily: 'Inter-SemiBold',
    color: '#1F2937',
    marginBottom: 12,
  },
  statusOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statusOption: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  statusOptionActive: {
    backgroundColor: '#7C3AED',
    borderColor: '#7C3AED',
  },
  statusOptionText: {
    fontSize: 12,
    fontFamily: 'Inter-Medium',
    color: '#6B7280',
  },
  statusOptionTextActive: {
    color: '#FFFFFF',
  },
  customOrderCard: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 16,
  },
  reviewsSubtitle: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
    color: '#6B7280',
    marginBottom: 16,
    textAlign: 'center',
  },
  reviewProductHeader: {
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  reviewProductDetails: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
    color: '#9CA3AF',
    marginTop: 2,
  },
  reviewSection: {
    marginBottom: 20,
    paddingVertical: 16,
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  reviewProductName: {
    fontSize: 16,
    fontFamily: 'Inter-SemiBold',
    color: '#1F2937',
  },
  customOrderTitle: {
    fontSize: 16,
    fontFamily: 'Inter-SemiBold',
    color: '#1F2937',
    marginBottom: 8,
  },
  customOrderDescription: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    color: '#6B7280',
    lineHeight: 20,
    marginBottom: 12,
  },
  customOrderMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  customOrderMetaItem: {
    fontSize: 12,
    fontFamily: 'Inter-SemiBold',
    color: '#7C3AED',
  },
  enhancedDetailsSection: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  enhancedDetailsTitle: {
    fontSize: 14,
    fontFamily: 'Inter-SemiBold',
    color: '#1F2937',
    marginBottom: 12,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  detailContent: {
    marginLeft: 8,
    flex: 1,
  },
  detailLabel: {
    fontSize: 12,
    fontFamily: 'Inter-Medium',
    color: '#6B7280',
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    color: '#1F2937',
  },
  invoicesSection: {
    marginTop: 16,
  },
  invoicesTitle: {
    fontSize: 14,
    fontFamily: 'Inter-SemiBold',
    color: '#1F2937',
    marginBottom: 8,
  },
  invoiceCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  invoiceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  invoiceAmount: {
    fontSize: 16,
    fontFamily: 'Inter-Bold',
    color: '#1F2937',
  },
  invoiceStatus: {
    fontSize: 12,
    fontFamily: 'Inter-SemiBold',
  },
  invoiceDescription: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    color: '#6B7280',
    marginBottom: 4,
  },
  invoiceDate: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
    color: '#9CA3AF',
  },
  sendInvoiceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#7C3AED',
    borderRadius: 8,
    paddingVertical: 12,
    marginTop: 16,
    gap: 8,
  },
  sendInvoiceText: {
    fontSize: 14,
    fontFamily: 'Inter-SemiBold',
    color: '#FFFFFF',
  },
  invoiceAlreadySentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#D1FAE5',
    borderRadius: 8,
    padding: 12,
    marginTop: 16,
    gap: 8,
  },
  invoiceAlreadySentText: {
    fontSize: 14,
    fontFamily: 'Inter-SemiBold',
    color: '#10B981',
  },
  itemCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    backgroundColor: '#F9FAFB',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: 14,
    fontFamily: 'Inter-SemiBold',
    color: '#1F2937',
    marginBottom: 4,
  },
  itemVariants: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
    color: '#6B7280',
    marginBottom: 2,
  },
  itemQuantity: {
    fontSize: 12,
    fontFamily: 'Inter-Medium',
    color: '#7C3AED',
  },
  itemPrice: {
    fontSize: 14,
    fontFamily: 'Inter-Bold',
    color: '#1F2937',
  },
  summaryCard: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  summaryLabel: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    color: '#6B7280',
  },
  summaryValue: {
    fontSize: 14,
    fontFamily: 'Inter-SemiBold',
    color: '#1F2937',
  },
  discountValue: {
    fontSize: 14,
    fontFamily: 'Inter-SemiBold',
    color: '#10B981',
  },
  summaryTotal: {
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingTop: 8,
    marginTop: 8,
    marginBottom: 0,
  },
  summaryTotalLabel: {
    fontSize: 16,
    fontFamily: 'Inter-Bold',
    color: '#1F2937',
  },
  summaryTotalValue: {
    fontSize: 16,
    fontFamily: 'Inter-Bold',
    color: '#7C3AED',
  },
  paymentCard: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 16,
  },
  paymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  paymentInfo: {
    marginLeft: 12,
  },
  paymentMethod: {
    fontSize: 14,
    fontFamily: 'Inter-SemiBold',
    color: '#1F2937',
    marginBottom: 2,
  },
  paymentStatus: {
    fontSize: 12,
    fontFamily: 'Inter-Medium',
    marginBottom: 2,
  },
  paymentCurrency: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
    color: '#7C3AED',
    fontStyle: 'italic',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  invoiceModalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    width: '90%',
    maxWidth: 400,
  },
  invoiceModalTitle: {
    fontSize: 18,
    fontFamily: 'Inter-Bold',
    color: '#1F2937',
    marginBottom: 20,
    textAlign: 'center',
  },
  invoiceForm: {
    marginBottom: 24,
  },
  invoiceFormLabel: {
    fontSize: 14,
    fontFamily: 'Inter-SemiBold',
    color: '#374151',
    marginBottom: 8,
  },
  invoiceFormInput: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: 'Inter-Regular',
    color: '#1F2937',
    marginBottom: 16,
  },
  invoiceFormTextArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  currencyNote: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
    color: '#7C3AED',
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 8,
  },
  warningCard: {
    backgroundColor: '#FEF3C7',
    borderRadius: 8,
    padding: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  warningText: {
    fontSize: 12,
    fontFamily: 'Inter-Medium',
    color: '#92400E',
    textAlign: 'center',
  },
  invoiceModalActions: {
    flexDirection: 'row',
    gap: 12,
  },
  invoiceModalCancel: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
  },
  invoiceModalCancelText: {
    fontSize: 14,
    fontFamily: 'Inter-SemiBold',
    color: '#6B7280',
  },
  invoiceModalSend: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#7C3AED',
    alignItems: 'center',
  },
  invoiceModalSendText: {
    fontSize: 14,
    fontFamily: 'Inter-SemiBold',
    color: '#FFFFFF',
  },
});