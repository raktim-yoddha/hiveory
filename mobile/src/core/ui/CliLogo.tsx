import { Image, StyleSheet, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import type { IconReference } from '@shared/domain/cli'
import { radius, useTheme } from '../theme'

/** A CLI's official mark, from the computer's own registry (never hardcoded here, AGENTS.md rule 15). */
export function CliLogo({ icon, size = 28 }: { icon?: IconReference; size?: number }) {
  const { colors } = useTheme()
  const inner = Math.round(size * 0.64)
  return (
    <View style={[styles.tile, { width: size, height: size, backgroundColor: colors.logoTile }]}>
      {icon?.kind === 'svg' ? (
        <Svg width={inner} height={inner} viewBox={icon.viewBox}>
          <Path d={icon.path} fill={icon.color} />
        </Svg>
      ) : icon?.kind === 'image' ? (
        <Image source={{ uri: icon.src }} style={{ width: inner, height: inner }} resizeMode="contain" />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  tile: { borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' }
})
