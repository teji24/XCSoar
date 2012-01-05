/*
Copyright_License {

  XCSoar Glide Computer - http://www.xcsoar.org/
  Copyright (C) 2000-2011 The XCSoar Project
  A detailed list of copyright holders can be found in the file "AUTHORS".

  This program is free software; you can redistribute it and/or
  modify it under the terms of the GNU General Public License
  as published by the Free Software Foundation; either version 2
  of the License, or (at your option) any later version.

  This program is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU General Public License for more details.

  You should have received a copy of the GNU General Public License
  along with this program; if not, write to the Free Software
  Foundation, Inc., 59 Temple Place - Suite 330, Boston, MA  02111-1307, USA.
}
*/

#include "SymbolsConfigPanel.hpp"
#include "Profile/ProfileKeys.hpp"
#include "DataField/Enum.hpp"
#include "DataField/Base.hpp"
#include "Interface.hpp"
#include "Language/Language.hpp"
#include "Form/Form.hpp"
#include "Form/RowFormWidget.hpp"
#include "Screen/Layout.hpp"
#include "Dialogs/CallBackTable.hpp"
#include "UIGlobals.hpp"

enum ControlIndex {
  DisplayTrackBearing,
  EnableFLARMMap,
  Trail,
  TrailDrift,
  SnailType,
  SnailWidthScale,
  DetourCostMarker,
  AircraftSymbol,
  WindArrowStyle
};
/*
<Edit Name="prpDisplayTrackBearing" Caption="Track bearing" X="2" Width="-2" Height="22" CaptionWidth="150"
  Help="Display the track bearing (ground track projection) on the map.&#10;[Off] Disable display of track bearing.&#10;[On] Always display track bearing.&#10;[Auto] Display track bearing if there is a significant difference to plane heading.">
  <DataField DataType="enum"/>

<Edit Name="prpEnableFLARMMap" Caption="FLARM traffic" X="2" Width="-2" Height="22" CaptionWidth="150"
  Help="This enables the display of FLARM traffic on the map window.">
  <DataField DataType="boolean"/>

<Edit Name="prpTrail" Caption="Trail length" Expert="1" X="2" Width="-2" Height="22" CaptionWidth="150"
  Help="Determines whether and how long a snail trail is drawn behind the glider">
  <DataField DataType="enum" OnDataAccess="OnTrailLength"/>

<Edit Name="prpTrailDrift" Caption="Trail drift" Expert="1" X="2" Width="-2" Height="22" CaptionWidth="150"
  Help="Determines whether the snail trail is drifted with the wind when displayed in circling mode.">
  <DataField DataType="boolean"/>

<Edit Name="prpSnailType" Caption="Trail type" Expert="1" X="2" Width="-2" Height="22" CaptionWidth="150"
  Help="Sets the type of the snail trail display.">
  <DataField DataType="enum" />

<Edit Name="prpSnailWidthScale" Caption="Trail scaled" Expert="1" X="2" Width="-2" Height="22" CaptionWidth="150"
  Help="If set to ON the snail trail width is scaled according to the vario signal.">
  <DataField DataType="boolean"/>

<Edit Name="prpDetourCostMarker" Caption="Detour cost markers" Expert="1" X="2" Width="-2" Height="22" CaptionWidth="150"
   Help="If the aircraft heading deviates from the current waypoint, markers are displayed at points ahead of the aircraft. The value of each marker is the extra distance required to reach that point as a percentage of straight-line distance to the waypoint.">
  <DataField DataType="boolean"/>

<Edit Name="prpAircraftSymbol" Caption="Aircraft symbol" Expert="1" X="2" Width="-2" Height="22" CaptionWidth="150"
  Help="Sets the symbol used for the aircraft.&#10;[Simple] Simplified line graphics, black with white contours.&#10;[Simple (large)] Enlarged simple graphics.&#10;[Detailed] Rendered aircraft graphics.">
  <DataField DataType="enum" />

<Edit Name="prpWindArrowStyle" Caption="Wind arrow" Expert="1" X="2" Width="-2" Height="22" CaptionWidth="150"
  Help="Determines the way the wind arrow is drawn on the map.&#10;[Arrow head] Draws an arrow head only&#10;[Full arrow] Draws an arrow head with a dashed arrow line">
  <DataField DataType="enum"/>
*/
class SymbolsConfigPanel : public RowFormWidget {
public:
  SymbolsConfigPanel()
    :RowFormWidget(UIGlobals::GetDialogLook(), Layout::Scale(150)) {}

public:
  virtual void Prepare(ContainerWindow &parent, const PixelRect &rc);
  virtual bool Save(bool &changed, bool &require_restart);
  void ShowTrailControls(bool show);
};

/** XXX this hack is needed because the form callbacks don't get a
    context pointer - please refactor! */
static SymbolsConfigPanel *instance;

void
SymbolsConfigPanel::ShowTrailControls(bool show)
{
  GetControl(TrailDrift).set_visible(show);
  GetControl(SnailType).set_visible(show);
  GetControl(SnailWidthScale).set_visible(show);
}

static void
OnTrailLength(DataField *Sender,
              DataField::DataAccessKind_t Mode)
{
  const DataFieldEnum &df = *(const DataFieldEnum *)Sender;
  TrailLength trail_length = (TrailLength)df.GetAsInteger();
  instance->ShowTrailControls(trail_length != TRAIL_OFF);
}

static const StaticEnumChoice  track_bearing_mode_list[] = {
  { 0, N_("Off"), N_("Disable display of track bearing.") },
  { 1, N_("On"), N_("Always display track bearing.") },
  { 2, N_("Auto"), N_("Display track bearing if there is a significant difference to plane heading.") },
  { 0 }
};

const TCHAR *trail_length_help = N_("Determines whether and how long a snail trail is drawn behind the glider.");
static const StaticEnumChoice  trail_length_list[] = {
  { TRAIL_OFF, N_("Off"), trail_length_help },
  { TRAIL_LONG, N_("Long"), trail_length_help },
  { TRAIL_SHORT, N_("Short"), trail_length_help },
  { TRAIL_FULL, N_("Full"), trail_length_help },
  { 0 }
};

const TCHAR *trail_type_help = N_("Sets the type of the snail trail display.");
static const StaticEnumChoice  trail_type_list[] = {
  { 0, N_("Vario #1"), trail_type_help },
  { 1, N_("Vario #2"), trail_type_help },
  { 2, N_("Altitude"), trail_type_help },
  { 0 }
};

static const StaticEnumChoice  aircraft_symbol_list[] = {
  { acSimple, N_("Simple"),
    N_("Simplified line graphics, black with white contours.") },
  { acSimpleLarge, N_("Simple (large)"),
    N_("Enlarged simple graphics.") },
  { acDetailed, N_("Detailed"),
    N_("Detailed rendered aircraft graphics.") },
  { 0 }
};

static const StaticEnumChoice  wind_arrow_list[] = {
  { 0, N_("Arrow head"), N_("Draws an arrow head only.") },
  { 1, N_("Full arrow"), N_("Draws an arrow head with a dashed arrow line.") },
  { 0 }
};

void
SymbolsConfigPanel::Prepare(ContainerWindow &parent, const PixelRect &rc)
{
  const MapSettings &settings_map = CommonInterface::GetMapSettings();

  instance = this;

  AddEnum(_("Track bearing"),
          _("Display the track bearing (ground track projection) on the map."),
          track_bearing_mode_list, settings_map.display_track_bearing);

  AddBoolean(_("FLARM traffic"), _("This enables the display of FLARM traffic on the map window."),
             settings_map.show_flarm_on_map);

  // Expert item (TODO)
  AddEnum(_("Trail length"), _T(""), trail_length_list, settings_map.trail_length, OnTrailLength);

  // Expert item
  AddBoolean(_("Trail drift"),
             _("Determines whether the snail trail is drifted with the wind when displayed in "
                 "circling mode."),
             settings_map.trail_drift_enabled);

  // Expert item
  AddEnum(_("Trail type"), _T(""), trail_type_list, (int)settings_map.snail_type);

  // Expert item
  AddBoolean(_("Trail scaled"),
             _("If set to ON the snail trail width is scaled according to the vario signal."),
             settings_map.snail_scaling_enabled);

  // Expert item
  AddBoolean(_("Detour cost markers"),
             _("If the aircraft heading deviates from the current waypoint, markers are displayed "
                 "at points ahead of the aircraft. The value of each marker is the extra distance "
                 "required to reach that point as a percentage of straight-line distance to the waypoint."),
             settings_map.detour_cost_markers_enabled);

  // Expert item
  AddEnum(_("Aircraft symbol"), _T(""), aircraft_symbol_list, settings_map.aircraft_symbol);

  // Expert item
  AddEnum(_("Wind arrow"), _("Determines the way the wind arrow is drawn on the map."),
          wind_arrow_list, settings_map.wind_arrow_style);

  ShowTrailControls(settings_map.trail_length != TRAIL_OFF);
}

bool
SymbolsConfigPanel::Save(bool &_changed, bool &_require_restart)
{
  bool changed = false, require_restart = false;

  MapSettings &settings_map = CommonInterface::SetMapSettings();

  changed |= SaveValueEnum(DisplayTrackBearing, szProfileDisplayTrackBearing,
                           settings_map.display_track_bearing);

  changed |= SaveValue(EnableFLARMMap, szProfileEnableFLARMMap,
                       settings_map.show_flarm_on_map);

  changed |= SaveValueEnum(Trail, szProfileSnailTrail, settings_map.trail_length);

  changed |= SaveValue(TrailDrift, szProfileTrailDrift, settings_map.trail_drift_enabled);

  changed |= SaveValueEnum(SnailType, szProfileSnailType, settings_map.snail_type);

  changed |= SaveValue(SnailWidthScale, szProfileSnailWidthScale,
                       settings_map.snail_scaling_enabled);

  changed |= SaveValue(DetourCostMarker, szProfileDetourCostMarker,
                       settings_map.detour_cost_markers_enabled);

  changed |= SaveValueEnum(AircraftSymbol, szProfileAircraftSymbol, settings_map.aircraft_symbol);

  changed |= SaveValueEnum(WindArrowStyle, szProfileWindArrowStyle, settings_map.wind_arrow_style);

  _changed |= changed;
  _require_restart |= require_restart;

  return true;
}

Widget *
CreateSymbolsConfigPanel()
{
  return new SymbolsConfigPanel();
}
