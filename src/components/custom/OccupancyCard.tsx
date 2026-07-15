"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Building2 } from "lucide-react";

interface ClientSpace {
  id: string;
  buildingId: string;
  isOccupied: boolean;
  area: number;
}

interface ClientBuilding {
  id: string;
  name: string;
}

interface OccupancyCardProps {
  spaces: ClientSpace[];
  buildings: ClientBuilding[];
}

export function OccupancyCard({ spaces, buildings }: OccupancyCardProps) {
  const [selectedBuildingId, setSelectedBuildingId] = useState("all");

  const stats = useMemo(() => {
    const relevantSpaces =
      selectedBuildingId === "all"
        ? spaces
        : spaces.filter((space) => space.buildingId === selectedBuildingId);

    const totalArea = relevantSpaces.reduce(
      (sum, space) => sum + space.area,
      0,
    );
    const occupiedArea = relevantSpaces
      .filter((space) => space.isOccupied)
      .reduce((sum, space) => sum + space.area, 0);

    const occupancyRate = totalArea > 0 ? (occupiedArea / totalArea) * 100 : 0;

    return {
      occupiedArea,
      totalArea,
      totalSpaces: relevantSpaces.length,
      occupiedSpaces: relevantSpaces.filter((s) => s.isOccupied).length,
      occupancyRate,
    };
  }, [selectedBuildingId, spaces]);

  const formatNumber = (area: number) => {
    return area.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  };

  return (
    <Card className="min-w-0 shadow-lg hover:shadow-xl transition-shadow duration-300">
      <CardHeader className="flex flex-col space-y-0 pb-2">
        <div className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Occupied Area
          </CardTitle>
          <Building2 className="h-5 w-5 text-primary" />
        </div>
        <div className="pt-1">
          <Select
            value={selectedBuildingId}
            onValueChange={setSelectedBuildingId}
          >
            <SelectTrigger className="w-full h-8 text-xs">
              <SelectValue placeholder="Select a building" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Buildings</SelectItem>
              {buildings.map((building) => (
                <SelectItem key={building.id} value={building.id}>
                  {building.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl sm:text-3xl font-bold font-headline text-foreground">
          <span>{formatNumber(stats.occupiedArea)}</span>
          <span className="text-lg sm:text-xl font-medium text-muted-foreground">
            {" "}
            / {formatNumber(stats.totalArea)} m²
          </span>
        </div>
        <p className="text-xs text-muted-foreground pt-1">
          {stats.occupancyRate.toFixed(1)}% of total area is occupied.
        </p>
        <p className="text-xs text-muted-foreground pt-1">
          Spaces: {stats.occupiedSpaces} / {stats.totalSpaces} occupied
        </p>
      </CardContent>
    </Card>
  );
}
