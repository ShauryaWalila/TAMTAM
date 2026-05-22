import React, { useState, useEffect } from 'react';
import { StyleSheet, View, TextInput, TouchableOpacity, Text, Image, ScrollView, Modal, ActivityIndicator, Alert } from 'react-native';
import { BlurView } from 'expo-blur';
import { X, Camera, MapPin, Save, Plus, Trash2 } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as base64js from 'base64-js';

import { View as ThemedView, Text as ThemedText } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { supabase } from '@/lib/supabase';

async function uploadPlaceImage(uri: string): Promise<string> {
  if (uri.startsWith('http')) return uri; // already remote
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const filePath = `places/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await supabase.storage
    .from('journal-assets')
    .upload(filePath, base64js.toByteArray(base64), { contentType: 'image/jpeg' });
  if (error) throw error;
  const { data: { publicUrl } } = supabase.storage.from('journal-assets').getPublicUrl(filePath);
  return publicUrl;
}

interface AddPinModalProps {
  isVisible: boolean;
  onClose: () => void;
  coordinate: { latitude: number; longitude: number } | null;
  onSuccess: () => void;
  isPlanMode: boolean;
  editingPin?: any;
  prefillName?: string;
}

export default function AddPinModal({ isVisible, onClose, coordinate, onSuccess, isPlanMode, editingPin, prefillName }: AddPinModalProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [currentCoord, setCurrentCoord] = useState<{ latitude: number; longitude: number } | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (editingPin) {
      setName(editingPin.name || '');
      setNotes(editingPin.notes || '');
      // Supabase may return images as either an array (jsonb) or a JSON string
      // (text column). Normalise to array of URI strings.
      let imgs: any = editingPin.images;
      if (typeof imgs === 'string') {
        try { imgs = JSON.parse(imgs); } catch { imgs = []; }
      }
      setImages(Array.isArray(imgs) ? imgs.filter((u: any) => typeof u === 'string' && u) : []);
      setCurrentCoord({ latitude: editingPin.latitude, longitude: editingPin.longitude });
    } else {
      setName(prefillName || '');
      setNotes('');
      setImages([]);
      setCurrentCoord(coordinate);
    }
  }, [editingPin, isVisible, coordinate, prefillName]);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 0.8,
    });

    if (!result.canceled) {
      setImages([...images, ...result.assets.map(a => a.uri)]);
    }
  };

  const handleSave = async () => {
    if (!name || !currentCoord) return;
    setIsSaving(true);

    try {
      // Upload any local file:// images to Supabase Storage so the partner can
      // see them too. Already-remote URLs pass through unchanged.
      const uploadedImages: string[] = [];
      for (const uri of images) {
        try { uploadedImages.push(await uploadPlaceImage(uri)); }
        catch (e) { console.warn('Image upload failed, skipping', e); }
      }

      const pinData = {
        name,
        notes,
        latitude: currentCoord.latitude,
        longitude: currentCoord.longitude,
        images: uploadedImages,
        category: isPlanMode ? (editingPin?.category || 'visit') : 'memory',
      };

      if (editingPin) {
        const { error } = await supabase
          .from('places')
          .update(pinData)
          .eq('id', editingPin.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('places')
          .insert([{
            ...pinData,
            trip_id: isPlanMode ? 'temp-trip-id' : null,
          }]);
        if (error) throw error;
      }
      
      onSuccess();
      onClose();
    } catch (error) {
      console.error('Error saving pin:', error);
      alert('Failed to save pin. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editingPin) return;
    
    Alert.alert(
      "Delete Memory",
      "Are you sure you want to permanently remove this memory from your life map? This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Delete", 
          style: "destructive", 
          onPress: async () => {
            setIsDeleting(true);
            try {
              const { error } = await supabase
                .from('places')
                .delete()
                .eq('id', editingPin.id);
              if (error) throw error;
              onSuccess();
              onClose();
            } catch (error) {
              console.error('Error deleting pin:', error);
              Alert.alert('Error', 'Failed to delete pin.');
            } finally {
              setIsDeleting(false);
            }
          }
        }
      ]
    );
  };

  return (
    <Modal
      visible={isVisible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <BlurView intensity={100} tint={colorScheme} style={styles.modalContainer}>
          <View style={styles.header}>
            <ThemedText style={styles.title}>{editingPin ? 'Edit Memory' : 'Add New Memory'}</ThemedText>
            <View style={styles.headerActions}>
              {editingPin && (
                <TouchableOpacity onPress={handleDelete} style={styles.deleteButton} disabled={isDeleting}>
                  {isDeleting ? <ActivityIndicator size="small" color="#FF4B4B" /> : <Trash2 size={22} color="#FF4B4B" />}
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                <X size={24} color={Colors[colorScheme].text} />
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView style={styles.form} showsVerticalScrollIndicator={false}>
            <View style={styles.inputGroup}>
              <ThemedText style={styles.label}>Place Name</ThemedText>
              <TextInput
                style={[styles.input, { color: Colors[colorScheme].text, borderColor: Colors[colorScheme].tabIconDefault + '40' }]}
                placeholder="Where was this?"
                placeholderTextColor="#999"
                value={name}
                onChangeText={setName}
              />
            </View>

            {currentCoord && (
              <View style={styles.locationTag}>
                <MapPin size={14} color={Colors[colorScheme].tint} />
                <Text style={[styles.locationText, { color: Colors[colorScheme].text }]}>
                  Location Set: {currentCoord.latitude.toFixed(4)}, {currentCoord.longitude.toFixed(4)}
                </Text>
              </View>
            )}

            <View style={styles.inputGroup}>
              <ThemedText style={styles.label}>Memories & Notes</ThemedText>
              <TextInput
                style={[styles.input, styles.textArea, { color: Colors[colorScheme].text, borderColor: Colors[colorScheme].tabIconDefault + '40' }]}
                placeholder="What happened here? Tell the story..."
                placeholderTextColor="#999"
                multiline
                numberOfLines={4}
                value={notes}
                onChangeText={setNotes}
              />
            </View>

            <View style={styles.inputGroup}>
              <ThemedText style={styles.label}>Photos</ThemedText>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imageScroll}>
                <TouchableOpacity style={[styles.addImage, { borderColor: Colors[colorScheme].tint }]} onPress={pickImage}>
                  <Camera size={30} color={Colors[colorScheme].tint} />
                  <Text style={[styles.addImageText, { color: Colors[colorScheme].tint }]}>Add Photo</Text>
                </TouchableOpacity>
                {images.map((uri, index) => (
                  <View key={index} style={styles.imageWrapper}>
                    <Image source={{ uri }} style={styles.image} />
                    <TouchableOpacity 
                      style={styles.removeImage} 
                      onPress={() => setImages(images.filter((_, i) => i !== index))}
                    >
                      <X size={14} color="white" />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            </View>
          </ScrollView>

          <TouchableOpacity 
            style={[styles.saveButton, { backgroundColor: Colors[colorScheme].tint }, (!name || isSaving) && styles.disabledButton]}
            onPress={handleSave}
            disabled={!name || isSaving}
          >
            {isSaving ? (
              <ActivityIndicator color="white" />
            ) : (
              <>
                <Save size={20} color="white" />
                <Text style={styles.saveButtonText}>{editingPin ? 'Update Memory' : 'Save to Our Life'}</Text>
              </>
            )}
          </TouchableOpacity>
        </BlurView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalContainer: {
    height: '80%',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    padding: 20,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 25,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
  },
  closeButton: {
    padding: 5,
    marginLeft: 15,
  },
  deleteButton: {
    padding: 5,
  },
  form: {
    flex: 1,
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
    opacity: 0.7,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
  },
  locationTag: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    backgroundColor: 'rgba(0,0,0,0.05)',
    padding: 10,
    borderRadius: 10,
  },
  locationText: {
    fontSize: 12,
    marginLeft: 8,
    opacity: 0.6,
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  imageScroll: {
    flexDirection: 'row',
  },
  addImage: {
    width: 100,
    height: 100,
    borderRadius: 15,
    borderWidth: 2,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  addImageText: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 5,
  },
  imageWrapper: {
    width: 100,
    height: 100,
    marginRight: 10,
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
    borderRadius: 15,
  },
  removeImage: {
    position: 'absolute',
    top: -5,
    right: -5,
    backgroundColor: 'rgba(0,0,0,0.6)',
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
    borderRadius: 20,
    marginTop: 10,
    marginBottom: 20,
  },
  saveButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 10,
  },
  disabledButton: {
    opacity: 0.5,
  }
});
