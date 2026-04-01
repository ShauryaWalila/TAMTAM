import React, { useState, useRef } from 'react';
import { StyleSheet, Image, Dimensions, View, TouchableOpacity, FlatList, Animated, Text } from 'react-native';
import { MotiView } from 'moti';
import { X, Pencil, Sparkles } from 'lucide-react-native';
import { format } from 'date-fns';
import { Link } from 'expo-router';
import { MonoText } from '@/components/StyledText';

// @ts-ignore
import PolaroidFrame from '../../assets/images/polaroid2.png';

const { width, height } = Dimensions.get('window');
const FRAME_WIDTH = width * 1.2; 
const FRAME_HEIGHT = FRAME_WIDTH * 1.4; 
const PHOTO_WINDOW_WIDTH = FRAME_WIDTH * 0.75;

interface FloatingPopupProps {
  pin: any;
  onClose: () => void;
  onEdit: (pin: any) => void;
  isPlanMode: boolean;
}

export default function FloatingPopup({ pin, onClose, onEdit, isPlanMode }: FloatingPopupProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  
  if (pin.isBucketPopup) {
    return (
      <MotiView
        from={{ opacity: 0, scale: 0.9, translateY: 20 }}
        animate={{ opacity: 1, scale: 1, translateY: 0 }}
        style={styles.bucketContainer}
      >
        <View style={styles.bucketContent}>
          <View style={styles.bucketHeader}>
            <Text style={styles.bucketName} numberOfLines={1}>{pin.name}</Text>
            <TouchableOpacity onPress={onClose} style={styles.bucketClose}><X size={20} color="#888" /></TouchableOpacity>
          </View>
          <View style={styles.bucketBody}>
            <View style={[styles.catBadge, { backgroundColor: (pin.category === 'eat' ? '#FF9500' : pin.category === 'hotel' ? '#5856D6' : '#34C759') + '15' }]}>
              <Text style={[styles.catBadgeText, { color: pin.category === 'eat' ? '#FF9500' : pin.category === 'hotel' ? '#5856D6' : '#34C759' }]}>
                {pin.category?.toUpperCase() || 'PLACE'}
              </Text>
            </View>
            <Text style={styles.bucketNotes}>{pin.notes || "No personal notes added yet."}</Text>
            <View style={styles.tapHint}>
              <Sparkles size={12} color="#aaa" />
              <Text style={styles.tapHintText}>Double-tap marker to add to plan</Text>
            </View>
          </View>
        </View>
      </MotiView>
    );
  }

  const images = pin.images && pin.images.length > 0 ? pin.images : [pin.image_url || 'https://via.placeholder.com/400x300'];

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems.length > 0) {
      setActiveIndex(viewableItems[0].index);
    }
  }).current;

  const renderDots = () => {
    if (images.length <= 1) return null;
    return (
      <View style={styles.dotsContainer}>
        {images.map((_, index) => {
          const isSelected = activeIndex === index;
          const distance = Math.abs(activeIndex - index);
          const opacity = distance > 2 ? 0.3 : 1;
          const scale = distance === 0 ? 1.2 : distance === 1 ? 0.8 : 0.5;

          return (
            <MotiView
              key={index}
              animate={{ scale, opacity, backgroundColor: isSelected ? '#444' : '#ccc' }}
              transition={{ type: 'timing', duration: 200 }}
              style={styles.dot}
            />
          );
        })}
      </View>
    );
  };

  return (
    <MotiView
      from={{ opacity: 0, scale: 0.9, translateY: 50 }}
      animate={{ opacity: 1, scale: 1, translateY: 0 }}
      transition={{ type: 'timing', duration: 400 }}
      style={styles.container}
    >
      <View style={styles.photoWindow}>
        <FlatList
          data={images}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={{ itemVisiblePercentThreshold: 50 }}
          keyExtractor={(_, index) => index.toString()}
          renderItem={({ item }) => (
            <Image 
              source={{ uri: item }} 
              style={styles.actualPhoto} 
              resizeMode="cover"
            />
          )}
        />
      </View>

      <Image 
        source={PolaroidFrame} 
        style={styles.frameAsset} 
        resizeMode="contain" 
        pointerEvents="none"
      />

      <View style={styles.controlsLayer} pointerEvents="box-none">
        <View style={styles.topActions}>
          <TouchableOpacity onPress={() => onEdit(pin)} activeOpacity={0.7}>
            <View style={styles.actionButton}>
              <Pencil size={14} color="#444" />
            </View>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} activeOpacity={0.7}>
            <View style={styles.actionButton}>
              <X size={16} color="#444" />
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.dotsWrapper} pointerEvents="none">
          {renderDots()}
        </View>

        {pin.isWorkspaceItem ? (
          <View style={styles.bottomArea}>
            <MonoText style={styles.notesText} numberOfLines={2}>
              {pin.name}
            </MonoText>
            <MonoText style={styles.dateText}>
              {pin.category?.toUpperCase() || 'PLACE'}
            </MonoText>
          </View>
        ) : (
          <Link href={{ pathname: "/our-life/pin-details", params: { id: pin.id } }} asChild>
            <TouchableOpacity style={styles.bottomArea}>
              <MonoText style={styles.notesText} numberOfLines={2}>
                {pin.notes || pin.name || "Our beautiful day..."}
              </MonoText>
              <MonoText style={styles.dateText}>
                {pin.date_stamp ? format(new Date(pin.date_stamp), 'dd/MM/yyyy') : format(new Date(), 'dd/MM/yyyy')}
              </MonoText>
            </TouchableOpacity>
          </Link>
        )}
      </View>
    </MotiView>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: -50,
    alignSelf: 'center',
    width: FRAME_WIDTH,
    height: FRAME_HEIGHT,
    zIndex: 1000,
  },
  photoWindow: {
    position: 'absolute',
    width: '75%', 
    height: '50%',
    top: '18%',
    alignSelf: 'center',
    backgroundColor: '#1a1a1a', 
    overflow: 'hidden',
    zIndex: 1,
  },
  actualPhoto: {
    width: PHOTO_WINDOW_WIDTH,
    height: '100%',
  },
  frameAsset: {
    width: '100%',
    height: '100%',
    position: 'absolute',
    zIndex: 2,
  },
  controlsLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 3,
  },
  topActions: {
    position: 'absolute',
    top: '17%',
    right: '12%',
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    width: 25,
    height: 25,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  dotsWrapper: {
    position: 'absolute',
    top: '66%',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  dotsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 20,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginHorizontal: 3,
  },
  bottomArea: {
    position: 'absolute',
    bottom: '23%',
    width: '75%',
    alignSelf: 'center',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 15,
  },
  notesText: {
    fontSize: 18,
    color: '#2c3e50',
    textAlign: 'center',
    lineHeight: 22,
    fontFamily: 'SpaceMono-Regular',
  },
  dateText: {
    fontSize: 14,
    color: '#7f8c8d',
    textAlign: 'center',
    marginTop: 6,
    fontFamily: 'SpaceMono-Regular',
  },
  bucketContainer: {
    position: 'absolute',
    bottom: 120, 
    left: 20,
    right: 20,
    zIndex: 2000,
  },
  bucketContent: {
    backgroundColor: 'white',
    borderRadius: 30,
    padding: 20,
    elevation: 15,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 20,
  },
  bucketHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  bucketName: {
    fontSize: 18,
    fontWeight: '900',
    flex: 1,
    marginRight: 10,
  },
  bucketClose: {
    padding: 5,
  },
  bucketBody: {
    gap: 10,
  },
  catBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  catBadgeText: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  bucketNotes: {
    fontSize: 14,
    color: '#444',
    lineHeight: 20,
  },
  tapHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 5,
    opacity: 0.6,
  },
  tapHintText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#888',
  }
});
