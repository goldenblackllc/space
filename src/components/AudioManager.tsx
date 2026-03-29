'use client';

import { useEffect, useRef } from 'react';

interface AudioManagerProps {
  gameState: 'map' | 'battle' | 'other';
  activeBattle: boolean;
  colonizedEventId: string | null;
  musicOn: boolean;
}

const FADE_DURATION = 1000;
const FADE_STEPS = 20;

export default function AudioManager({
  gameState,
  activeBattle,
  colonizedEventId,
  musicOn,
}: AudioManagerProps) {
  const mapAudioRef = useRef<HTMLAudioElement | null>(null);
  const battleAudioRef = useRef<HTMLAudioElement | null>(null);
  const victoryAudioRef = useRef<HTMLAudioElement | null>(null);
  const crossfadeIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Track previous state to trigger fanfare
  const prevColonizedIdRef = useRef<string | null>(null);
  
  // Normalized volumes
  const MAP_VOL = 0.4;
  const BATTLE_VOL = 0.4;
  const VICTORY_VOL = 0.5;

  // Initialize audio elements
  useEffect(() => {
    mapAudioRef.current = new Audio('/assets/Sector_Eight_Alert_map_theme.mp3');
    mapAudioRef.current.loop = true;
    mapAudioRef.current.volume = 0;

    battleAudioRef.current = new Audio('/assets/Trajectory_Locked_battle_theme.mp3');
    battleAudioRef.current.loop = true;
    battleAudioRef.current.volume = 0;

    victoryAudioRef.current = new Audio('/assets/Boss_Level_Cleared_victory_fanfare.mp3');
    victoryAudioRef.current.loop = false;
    victoryAudioRef.current.volume = 0;

    // Cleanup on unmount
    return () => {
      mapAudioRef.current?.pause();
      battleAudioRef.current?.pause();
      victoryAudioRef.current?.pause();
    };
  }, []);

  // Handle music toggle
  useEffect(() => {
    if (musicOn) {
      if (!activeBattle && !victoryAudioRef.current?.ended) {
        mapAudioRef.current?.play().catch(() => {});
      }
    } else {
      mapAudioRef.current?.pause();
      battleAudioRef.current?.pause();
      victoryAudioRef.current?.pause();
      // reset volumes
      if (mapAudioRef.current) mapAudioRef.current.volume = 0;
      if (battleAudioRef.current) battleAudioRef.current.volume = 0;
      if (victoryAudioRef.current) victoryAudioRef.current.volume = 0;
    }
  }, [musicOn, activeBattle]);

  // Handle Colonization Fanfare
  useEffect(() => {
    if (!musicOn) return;

    if (colonizedEventId && colonizedEventId !== prevColonizedIdRef.current) {
      // Setup fanfare
      const mapAudio = mapAudioRef.current;
      const battleAudio = battleAudioRef.current;
      const victoryAudio = victoryAudioRef.current;

      if (!mapAudio || !battleAudio || !victoryAudio) return;

      // Pause/mute others instantly
      mapAudio.volume = 0;
      battleAudio.volume = 0;

      victoryAudio.currentTime = 0;
      victoryAudio.volume = VICTORY_VOL;
      
      const onEnded = () => {
        // Return to map theme
        if (!activeBattle) {
          mapAudio.volume = MAP_VOL;
          mapAudio.play().catch(() => {});
        } else {
          battleAudio.volume = BATTLE_VOL;
          battleAudio.play().catch(() => {});
        }
        victoryAudio.removeEventListener('ended', onEnded);
      };

      victoryAudio.addEventListener('ended', onEnded);
      victoryAudio.play().catch(() => {});
    }

    prevColonizedIdRef.current = colonizedEventId;
  }, [colonizedEventId, musicOn, activeBattle]);

  // Handle Map <-> Battle Crossfade
  useEffect(() => {
    if (!musicOn) return;
    
    // Don't interrupt fanfare
    const victoryAudio = victoryAudioRef.current;
    if (victoryAudio && !victoryAudio.ended && victoryAudio.currentTime > 0) {
      return;
    }

    const mapAudio = mapAudioRef.current;
    const battleAudio = battleAudioRef.current;

    if (!mapAudio || !battleAudio) return;

    if (crossfadeIntervalRef.current) {
      clearInterval(crossfadeIntervalRef.current);
    }

    const targetMapVol = activeBattle ? 0 : MAP_VOL;
    const targetBattleVol = activeBattle ? BATTLE_VOL : 0;

    const mapStep = (targetMapVol - mapAudio.volume) / FADE_STEPS;
    const battleStep = (targetBattleVol - battleAudio.volume) / FADE_STEPS;

    if (activeBattle) {
      battleAudio.play().catch(() => {});
    } else {
      mapAudio.play().catch(() => {});
    }

    let steps = 0;
    crossfadeIntervalRef.current = setInterval(() => {
      steps++;
      
      let newMapVol = mapAudio.volume + mapStep;
      let newBattleVol = battleAudio.volume + battleStep;
      
      if (newMapVol < 0) newMapVol = 0;
      if (newMapVol > MAP_VOL) newMapVol = MAP_VOL;
      if (newBattleVol < 0) newBattleVol = 0;
      if (newBattleVol > BATTLE_VOL) newBattleVol = BATTLE_VOL;
      
      // Use linear interpolation for volume crossfade
      mapAudio.volume = newMapVol;
      battleAudio.volume = newBattleVol;

      if (steps >= FADE_STEPS) {
        if (crossfadeIntervalRef.current) clearInterval(crossfadeIntervalRef.current);
        mapAudio.volume = targetMapVol;
        battleAudio.volume = targetBattleVol;
        
        if (targetMapVol === 0) mapAudio.pause();
        if (targetBattleVol === 0) battleAudio.pause();
      }
    }, FADE_DURATION / FADE_STEPS);

    return () => {
      if (crossfadeIntervalRef.current) {
        clearInterval(crossfadeIntervalRef.current);
      }
    };
  }, [activeBattle, musicOn]);

  return null;
}
