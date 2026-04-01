import React, { useState } from 'react';
import { StyleSheet, View, Image, TouchableOpacity, Text, Dimensions } from 'react-native';
import { BlurView } from 'expo-blur';
import { MotiView } from 'moti';
import { ChevronLeft, ChevronRight, X, Info, Pencil } from 'lucide-react-native';
import { format } from 'date-fns';
import { Link } from 'expo-router';

import { MonoText } from '@/components/StyledText';
import { Text as ThemedText } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

const { width } = Dimensions.get('window');

interface PolaroidPopupProps {
  pin: any;
  onClose: () => void;
  onEdit: (pin: any) => void;
  isPlanMode: boolean;
}

export default function PolaroidPopup({ pin, onClose, onEdit, isPlanMode }: PolaroidPopupProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  // Placeholder images if none provided
  const images = pin.images && pin.images.length > 0 ? pin.images : [pin.image_url || 'https://via.placeholder.com/300'];

  return (
    <MotiView
      from={{ opacity: 0, translateY: 100 }}
      animate={{ opacity: 1, translateY: 0 }}
      exit={{ opacity: 0, translateY: 100 }}
      style={styles.container}
    >
      <BlurView intensity={90} tint={colorScheme} style={styles.blurContainer}>
        <View style={styles.content}>
          <View style={styles.topActions}>
            <TouchableOpacity onPress={() => onEdit(pin)} style={styles.actionButton}>
              <Pencil size={18} color={Colors[colorScheme].text} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton} onPress={onClose}>
              <X size={20} color={Colors[colorScheme].text} />
            </TouchableOpacity>
          </View>

          {/* Polaroid Frame */}
          <View style={[styles.polaroidFrame, { backgroundColor: '#F9F9F9' }]}>
            <View style={styles.imageContainer}>
              <Image 
                source={{ uri: images[currentImageIndex] }} 
                style={styles.image} 
                resizeMode="cover"
              />
              {images.length > 1 && (
                <View style={styles.carouselArrows}>
                  <TouchableOpacity 
                    onPress={() => setCurrentImageIndex(prev => Math.max(0, prev - 1))}
                    disabled={currentImageIndex === 0}
                  >
                    <ChevronLeft size={24} color={currentImageIndex === 0 ? '#ccc' : '#000'} />
                  </TouchableOpacity>
                  <TouchableOpacity 
                    onPress={() => setCurrentImageIndex(prev => Math.min(images.length - 1, prev + 1))}
                    disabled={currentImageIndex === images.length - 1}
                  >
                    <ChevronRight size={24} color={currentImageIndex === images.length - 1 ? '#ccc' : '#000'} />
                  </TouchableOpacity>
                </View>
              )}
            </View>
            
            <View style={styles.polaroidFooter}>
              <MonoText style={styles.dateStamp}>
                {pin.date_stamp ? format(new Date(pin.date_stamp), 'dd.MM.yyyy') : format(new Date(), 'dd.MM.yyyy')}
              </MonoText>
              <Text style={styles.pinName} numberOfLines={1}>{pin.name}</Text>
            </View>
          </View>

          {/* Description and More Details */}
          <View style={styles.detailsContainer}>
            <ThemedText style={styles.description} numberOfLines={2}>
              {pin.notes || pin.description || 'No notes added yet...'}
            </ThemedText>
            
            <Link href={{ pathname: "/our-life/pin-details", params: { id: pin.id } }} asChild>
              <TouchableOpacity style={[styles.moreDetails, { backgroundColor: Colors[colorScheme].tint }]}>
                <Info size={16} color="white" />
                <Text style={styles.moreDetailsText}>More Details</Text>
              </TouchableOpacity>
            </Link>
          </View>
        </View>
      </BlurView>
    </MotiView>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    height: 350,
    zIndex: 30,
  },
  blurContainer: {
    flex: 1,
    borderRadius: 25,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  content: {
    padding: 15,
    flex: 1,
  },
  topActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 5,
    gap: 15,
  },
  actionButton: {
    padding: 5,
  },
  polaroidFrame: {
    width: '100%',
    height: 220,
    padding: 10,
    paddingBottom: 40,
    borderRadius: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  imageContainer: {
    flex: 1,
    backgroundColor: '#eee',
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  carouselArrows: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 5,
  },
  polaroidFooter: {
    position: 'absolute',
    bottom: 5,
    left: 10,
    right: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dateStamp: {
    fontSize: 12,
    color: '#888',
  },
  pinName: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
    maxWidth: '60%',
  },
  detailsContainer: {
    marginTop: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  description: {
    fontSize: 14,
    flex: 1,
    marginRight: 10,
  },
  moreDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 15,
  },
  moreDetailsText: {
    color: 'white',
    fontWeight: 'bold',
    marginLeft: 5,
    fontSize: 12,
  },
});
