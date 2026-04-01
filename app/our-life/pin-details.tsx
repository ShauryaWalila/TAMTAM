import React from 'react';
import { StyleSheet, View, Text, Image, FlatList, TouchableOpacity, ScrollView, Dimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, Calendar, MapPin, MessageSquare, Shirt } from 'lucide-react-native';
import { BlurView } from 'expo-blur';
import { format } from 'date-fns';

import { View as ThemedView, Text as ThemedText } from '@/components/Themed';
import { MonoText } from '@/components/StyledText';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

const { width } = Dimensions.get('window');

export default function PinDetailsScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';

  // Mock data - in real app, fetch from Supabase using id
  const pin = {
    id,
    name: 'Le Marais Bakery',
    date_stamp: new Date(),
    location: 'San Francisco, CA',
    description: 'The best croissants in the city! We had such a lovely morning here. The atmosphere was perfect and the coffee was exactly what we needed.',
    images: [
      'https://via.placeholder.com/600x400',
      'https://via.placeholder.com/600x400',
      'https://via.placeholder.com/600x400',
    ],
    whatToWear: 'Casual Chic',
    category: 'eat'
  };

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <ChevronLeft size={28} color={Colors[colorScheme].text} />
          </TouchableOpacity>
          <ThemedText style={styles.headerTitle}>{pin.name}</ThemedText>
        </View>

        {/* Date and Location Chips */}
        <View style={styles.chipsContainer}>
          <BlurView intensity={20} tint={colorScheme} style={styles.chip}>
            <Calendar size={14} color={Colors[colorScheme].tint} />
            <Text style={[styles.chipText, { color: Colors[colorScheme].text }]}>
              {format(new Date(pin.date_stamp), 'MMMM do, yyyy')}
            </Text>
          </BlurView>
          <BlurView intensity={20} tint={colorScheme} style={styles.chip}>
            <MapPin size={14} color={Colors[colorScheme].tint} />
            <Text style={[styles.chipText, { color: Colors[colorScheme].text }]}>{pin.location}</Text>
          </BlurView>
        </View>

        {/* Image Gallery */}
        <FlatList
          data={pin.images}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item, index) => index.toString()}
          renderItem={({ item }) => (
            <View style={styles.imageWrapper}>
              <Image source={{ uri: item }} style={styles.galleryImage} />
            </View>
          )}
          style={styles.gallery}
        />

        {/* Content Sections */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <MessageSquare size={18} color={Colors[colorScheme].tint} />
            <ThemedText style={styles.sectionTitle}>Our Memories</ThemedText>
          </View>
          <ThemedText style={styles.description}>{pin.description}</ThemedText>
        </View>

        {pin.whatToWear && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Shirt size={18} color={Colors[colorScheme].tint} />
              <ThemedText style={styles.sectionTitle}>What We Wore</ThemedText>
            </View>
            <ThemedText style={styles.description}>{pin.whatToWear}</ThemedText>
          </View>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  backButton: {
    marginRight: 15,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  chipsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginBottom: 20,
    flexWrap: 'wrap',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
    marginRight: 10,
    marginBottom: 10,
    overflow: 'hidden',
  },
  chipText: {
    fontSize: 12,
    marginLeft: 6,
    fontWeight: '500',
  },
  gallery: {
    height: 300,
    marginBottom: 30,
  },
  imageWrapper: {
    width: width,
    height: 300,
    paddingHorizontal: 20,
  },
  galleryImage: {
    width: '100%',
    height: '100%',
    borderRadius: 20,
  },
  section: {
    paddingHorizontal: 20,
    marginBottom: 25,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  description: {
    fontSize: 16,
    lineHeight: 24,
    opacity: 0.8,
  },
});
