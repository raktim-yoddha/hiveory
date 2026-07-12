export interface QueenBeeTask {
  id: string;
  description: string;
  owns: string[];
  reads: string[];
  dependsOn: string[];
  suggestedRole: 'builder' | 'scout' | 'reviewer';
  suggestedCli: string;
}

export interface BreakdownResult {
  goal: string;
  tasks: QueenBeeTask[];
  warnings: string[];
}

export interface Assignment {
  taskId: string;
  cli: string;
  role: 'builder' | 'scout' | 'reviewer' | 'coordinator';
}
