/*
Copyright_License {

  XCSoar Glide Computer - http://www.xcsoar.org/
  Copyright (C) 2000 - 2009

	M Roberts (original release)
	Robin Birch <robinb@ruffnready.co.uk>
	Samuel Gisiger <samuel.gisiger@triadis.ch>
	Jeff Goodenough <jeff@enborne.f2s.com>
	Alastair Harrison <aharrison@magic.force9.co.uk>
	Scott Penrose <scottp@dd.com.au>
	John Wharington <jwharington@gmail.com>
	Lars H <lars_hn@hotmail.com>
	Rob Dunning <rob@raspberryridgesheepfarm.com>
	Russell King <rmk@arm.linux.org.uk>
	Paolo Ventafridda <coolwind@email.it>
	Tobias Lohner <tobias@lohner-net.de>
	Mirek Jezek <mjezek@ipplc.cz>
	Max Kellermann <max@duempel.org>

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

#include "InfoBoxManager.h"
#include "Protection.hpp"
#include "Device/Parser.h"
#include "Settings.hpp"
#include "SettingsComputer.hpp"
#include "SettingsTask.hpp"
#include "Math/FastMath.h"
#include "Device/device.h"
#include "Dialogs.h"
#include "Message.h"
#include "Device/Port.h"
#include "Atmosphere.h"
#include "Battery.h"
#include "WayPoint.hpp"
#include "Registry.hpp"
#include "MapWindow.h"
#include "McReady.h"
#include "Interface.hpp"
#include "Components.hpp"
#include "GlideComputer.hpp"
#include <stdlib.h>
#include "FlarmCalculations.h"

#define m_max(a,b)	(((a)>(b))?(a):(b))
// JMW added key codes,
// so -1 down
//     1 up
//     0 enter
//
// TODO: make a proper class

void
CommonInterface::on_key_Airspeed(int UpDown)
{
  if (UpDown==0) {
    SetSettingsComputer().EnableCalibration = 
      !SettingsComputer().EnableCalibration;

    if (SettingsComputer().EnableCalibration)
      Message::AddMessage(TEXT("Calibrate ON"));
    else
      Message::AddMessage(TEXT("Calibrate OFF"));
  }
}

void	
CommonInterface::on_key_TeamCode(int UpDown)
{
  int tryCount = 0;
  int searchSlot = FindFlarmSlot(Basic(), TeamFlarmIdTarget);
  int newFlarmSlot = -1;
  
  while (tryCount < FLARM_MAX_TRAFFIC) {
    if (UpDown == 1) {
      searchSlot++;
      if (searchSlot > FLARM_MAX_TRAFFIC - 1) {
	searchSlot = 0;
      }
    } else if (UpDown == -1) {
      searchSlot--;
      if (searchSlot < 0) {
	searchSlot = FLARM_MAX_TRAFFIC - 1;
      }
    }
      
    if (Basic().FLARM_Traffic[searchSlot].ID != 0) {
      newFlarmSlot = searchSlot;
      break; // a new flarmSlot with a valid flarm traffic record was found !
    }
    tryCount++;
  }

  if (newFlarmSlot != -1) {
    TeamFlarmIdTarget = Basic().FLARM_Traffic[newFlarmSlot].ID;
      
    if (_tcslen(Basic().FLARM_Traffic[newFlarmSlot].Name) != 0) { 
      // copy the 3 first chars from the name to TeamFlarmCNTarget
      for (int z = 0; z < 3; z++) {
	if (Basic().FLARM_Traffic[newFlarmSlot].Name[z] != 0) {
	  SetSettingsComputer().TeamFlarmCNTarget[z] = 
	    Basic().FLARM_Traffic[newFlarmSlot].Name[z];
	} else {
	  SetSettingsComputer().TeamFlarmCNTarget[z] = 32; // add space char
	}
      }
      SetSettingsComputer().TeamFlarmCNTarget[3] = 0;
    } else {
      SetSettingsComputer().TeamFlarmCNTarget[0] = 0;
    }
  } else {
    // no flarm traffic to select!
    TeamFlarmIdTarget = 0;
    SetSettingsComputer().TeamFlarmCNTarget[0] = 0;
    return;
  }
}

void	
CommonInterface::on_key_Altitude(int UpDown)
{
#ifdef _SIM_
  if(UpDown==1) {
    device_blackboard.SetAltitude(Basic().Altitude+100/ALTITUDEMODIFY);
  } else if (UpDown==-1) {
    device_blackboard.SetAltitude(m_max(0,Basic().Altitude+100/ALTITUDEMODIFY));
  } else if (UpDown==-2) {
    on_key_Direction(-1);
  } else if (UpDown==2) {
    on_key_Direction(1);
  }
#endif
  return;
}

// VENTA3 QFE
void	
CommonInterface::on_key_QFEAltitude(int UpDown)
{
  short step;
  if ( ( Basic().Altitude - QFEAltitudeOffset ) <10 ) step=1; else step=10;
  if(UpDown==1) {
    QFEAltitudeOffset -= (step/ALTITUDEMODIFY);
  } else if (UpDown==-1) {
    QFEAltitudeOffset += (step/ALTITUDEMODIFY);
  } else if (UpDown==-2) {
    on_key_Direction(-1);
  } else if (UpDown==2) {
    on_key_Direction(1);
  }
  return;
}

// VENTA3 Alternates processing updown
void 
CommonInterface::on_key_Alternate1(int UpDown)
{
   if (UpDown==0) {
     if ( Alternate1 <0 ) return;
     mutexTaskData.Lock();
     SelectedWaypoint = Alternate1;
     PopupWaypointDetails();
     mutexTaskData.Unlock();
  }
}

void 
CommonInterface::on_key_Alternate2(int UpDown)
{
   if (UpDown==0) {
     if ( Alternate2 <0 ) return;
     mutexTaskData.Lock();
     SelectedWaypoint = Alternate2;
     PopupWaypointDetails();
     mutexTaskData.Unlock();
  }
}

void 
CommonInterface::on_key_BestAlternate(int UpDown)
{
   if (UpDown==0) {
     if ( BestAlternate <0 ) return;
     mutexTaskData.Lock();
     SelectedWaypoint = BestAlternate;
     PopupWaypointDetails();
     mutexTaskData.Unlock();
  }
}

void	
CommonInterface::on_key_Speed(int UpDown)
{
#ifdef _SIM_
  if(UpDown==1)
    device_blackboard.SetSpeed(Basic().Speed+10/SPEEDMODIFY);
  else if (UpDown==-1) {
    device_blackboard.SetSpeed(m_max(0,Basic().Speed+10/SPEEDMODIFY));
  } else if (UpDown==-2) {
    on_key_Direction(-1);
  } else if (UpDown==2) {
    on_key_Direction(1);
  }
#endif
  return;
}


void	
CommonInterface::on_key_Accelerometer(int UpDown)
{
  DWORD Temp;
  if (UpDown==0) {
    AccelerometerZero*= Basic().Gload;
    if (AccelerometerZero<1) {
      AccelerometerZero = 100;
    }
    Temp = (int)AccelerometerZero;
    SetToRegistry(szRegistryAccelerometerZero,Temp);
  }
}

void	
CommonInterface::on_key_WindDirection(int UpDown)
{
/* JMW ILLEGAL/incomplete
  if(UpDown==1)
    {
      Calculated().WindBearing  += 5;
      while (Calculated().WindBearing  >= 360)
	{
	  Calculated().WindBearing  -= 360;
	}
    }
  else if (UpDown==-1)
    {
      Calculated().WindBearing  -= 5;
      while (Calculated().WindBearing  < 0)
	{
	  Calculated().WindBearing  += 360;
	}
    } else if (UpDown == 0) {
    glide_computer.SetWindEstimate(Calculated().WindSpeed,
				   Calculated().WindBearing);
    SaveWindToRegistry();
  }
  return;
*/
}

void	CommonInterface::on_key_WindSpeed(int UpDown)
{
/* JMW ILLEGAL/incomplete
	if(UpDown==1)
		Calculated().WindSpeed += (1/SPEEDMODIFY);
	else if (UpDown== -1)
	{
		Calculated().WindSpeed -= (1/SPEEDMODIFY);
		if(Calculated().WindSpeed < 0)
			Calculated().WindSpeed = 0;
	}
	// JMW added faster way of changing wind direction
	else if (UpDown== -2) {
		on_key_WindDirection(-1);
	} else if (UpDown== 2) {
		on_key_WindDirection(1);
	} else if (UpDown == 0) {
          glide_computer.SetWindEstimate(Calculated().WindSpeed,
					 Calculated().WindBearing);
	  SaveWindToRegistry();
	}
*/
	return;
}

void	
CommonInterface::on_key_Direction(int UpDown)
{
#ifdef _SIM_
  if(UpDown==1) {
    device_blackboard.SetTrackBearing(Basic().TrackBearing+5);
  } else if (UpDown==-1) {
    device_blackboard.SetTrackBearing(Basic().TrackBearing-5);
  }
#endif
  return;
}


void	
CommonInterface::on_key_MacCready(int UpDown)
{
  double MACCREADY = GlidePolar::GetMacCready();
  if(UpDown==1) {
    MACCREADY += (double)0.1;
    if (MACCREADY>5.0) { // JMW added sensible limit
      MACCREADY=5.0;
    }
    GlidePolar::SetMacCready(MACCREADY);
  }
  else if(UpDown==-1) {
    MACCREADY -= (double)0.1;
    if(MACCREADY < 0) {
      MACCREADY = 0;
    }
    GlidePolar::SetMacCready(MACCREADY);
  }
  /* JMW illegal
 else if (UpDown==0)
    {
      Calculated().AutoMacCready 
	= !Calculated().AutoMacCready;
    }
  else if (UpDown==-2)
    {
      Calculated().AutoMacCready = false;  // SDP on auto maccready

    }
  else if (UpDown==+2)
    {
      Calculated().AutoMacCready = true;	// SDP off auto maccready

    }
  */

  // JMW TODO check scope
  devPutMacCready(devA(), MACCREADY);
  devPutMacCready(devB(), MACCREADY);

  return;
}


void	
CommonInterface::on_key_ForecastTemperature(int UpDown)
{
  if (UpDown==1) {
    CuSonde::adjustForecastTemperature(0.5);
  }
  if (UpDown== -1) {
    CuSonde::adjustForecastTemperature(-0.5);
  }
}


/*
	1	Next waypoint
	0	Show waypoint details
	-1	Previous waypoint
	2	Next waypoint with wrap around
	-2	Previous waypoint with wrap around
*/
void 
CommonInterface::on_key_Waypoint(int UpDown)
{
  mutexTaskData.Lock();

  if(UpDown>0) {
    if(ActiveWayPoint < MAXTASKPOINTS) {
      // Increment Waypoint
      if(Task[ActiveWayPoint+1].Index >= 0) {
	if(ActiveWayPoint == 0)	{
	  // manual start
	  // TODO bug: allow restart
	  // TODO bug: make this work only for manual
	  /* JMW ILLEGAL
	  if (Calculated().TaskStartTime==0) {
	    Calculated().TaskStartTime = Basic().Time;
	  }
	  */
	}
	ActiveWayPoint ++;
	AdvanceArmed = false;
	  /* JMW ILLEGAL
	Calculated().LegStartTime = Basic().Time ;
	  */
      }
      // No more, try first
      else
        if((UpDown == 2) && (Task[0].Index >= 0)) {
          /* ****DISABLED****
          if(ActiveWayPoint == 0)	{
            // TODO bug: allow restart
            // TODO bug: make this work only for manual

            // TODO bug: This should trigger reset of flight stats, but
            // should ask first...
            if (Calculated().TaskStartTime==0) {
              Calculated().TaskStartTime = Basic().Time ;
            }
          }
          */
          AdvanceArmed = false;
          ActiveWayPoint = 0;
	  /* JMW illegal
          Calculated().LegStartTime = Basic().Time ;
	  */
        }
    }
  }
  else if (UpDown<0){
    if(ActiveWayPoint >0) {

      ActiveWayPoint --;
      /*
	XXX How do we know what the last one is?
	} else if (UpDown == -2) {
	ActiveWayPoint = MAXTASKPOINTS;
      */
    } else {
      if (ActiveWayPoint==0) {

        RotateStartPoints();

	// restarted task..
	//	TODO bug: not required? Calculated().TaskStartTime = 0;
      }
    }
    glide_computer.ResetEnter();
  }
  else if (UpDown==0) {
    SelectedWaypoint = Task[ActiveWayPoint].Index;
    PopupWaypointDetails();
  }
  if (ActiveWayPoint>=0) {
    SelectedWaypoint = Task[ActiveWayPoint].Index;
  }
  mutexTaskData.Unlock();
}


void 
CommonInterface::on_key_None(int UpDown)
{
  (void)UpDown;
  return;
}
